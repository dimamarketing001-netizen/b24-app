from flask import Flask, request, jsonify, render_template
import requests
import datetime
import logging
import json
import threading
import os
from dotenv import load_dotenv

# Загружаем переменные окружения из .env файла
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), '..', '.env'))

logging.basicConfig(level=logging.INFO)
app = Flask(__name__, static_folder='static', template_folder='static')

# --- НАСТРОЙКИ ИЗ ПЕРЕМЕННЫХ ОКРУЖЕНИЯ ---
B24_WEBHOOK_URL = os.getenv("B24_WEBHOOK_URL")

# Загружаем словари из JSON-строк
try:
    DOCUMENT_TEMPLATE_MAPPING = json.loads(os.getenv("DOCUMENT_TEMPLATE_MAPPING", "{}"))
    HARDCODED_DEAL_TYPES = json.loads(os.getenv("HARDCODED_DEAL_TYPES", "[]"))
except (json.JSONDecodeError, TypeError):
    app.logger.error("Ошибка при загрузке конфигурации из .env. Проверьте формат JSON.")
    DOCUMENT_TEMPLATE_MAPPING = {}
    HARDCODED_DEAL_TYPES = []

if not B24_WEBHOOK_URL:
    app.logger.critical("Критическая ошибка: B24_WEBHOOK_URL не найден в .env файле!")


def get_b24_deal(deal_id):
    """Получает данные по конкретной сделке."""
    if not deal_id: return {}
    try:
        response = requests.post(B24_WEBHOOK_URL + 'crm.deal.get', json={'id': deal_id})
        response.raise_for_status()
        return response.json().get('result', {})
    except requests.exceptions.RequestException as e:
        app.logger.error(f"Ошибка при получении сделки: {e}")
        return {}

def run_b24_process(deal_id, total_amount, monthly_payments, first_payment_date_str, special_payments, deal_type_id):
    """
    Эта функция выполняется в фоновом потоке, чтобы не задерживать ответ браузеру.
    """
    app.logger.info(f"Фоновый процесс запущен для сделки {deal_id} с особыми платежами: {special_payments}, выбранный тип сделки: {deal_type_id}")
    
    # --- 1. Расчет графика платежей с учетом особых платежей ---
    product_rows = []
    first_payment_date = datetime.datetime.strptime(first_payment_date_str, '%Y-%m-%d').date()
    
    remaining_amount = total_amount
    remaining_payments_count = monthly_payments

    for i, special_amount in enumerate(special_payments):
        payment_date = first_payment_date + datetime.timedelta(days=30 * i)
        product_rows.append({
            "PRODUCT_NAME": payment_date.strftime('%d.%m.%Y'),
            "PRICE": special_amount,
            "QUANTITY": 1
        })
        remaining_amount -= special_amount
        remaining_payments_count -= 1

    if remaining_payments_count > 0:
        if remaining_amount < 0:
            app.logger.error("Ошибка расчета: сумма особых платежей превышает общую сумму договора.")
            return
        standard_payment_amount = round(remaining_amount / remaining_payments_count, 2)
        total_calculated = sum(special_payments) + standard_payment_amount * remaining_payments_count
        last_payment_adjustment = total_amount - total_calculated
        start_index = len(special_payments)
        for i in range(start_index, monthly_payments):
            payment_date = first_payment_date + datetime.timedelta(days=30 * i)
            current_payment = standard_payment_amount
            if i == monthly_payments - 1:
                current_payment += last_payment_adjustment
            product_rows.append({
                "PRODUCT_NAME": payment_date.strftime('%d.%m.%Y'),
                "PRICE": round(current_payment, 2),
                "QUANTITY": 1
            })

    # --- 2. Установка товаров в сделку ---
    app.logger.info(f"Отправка товарных позиций в сделку {deal_id}...")
    set_products_data = { 'id': deal_id, 'rows': product_rows }
    response = requests.post(B24_WEBHOOK_URL + 'crm.deal.productrows.set', json=set_products_data)
    app.logger.info(f"Ответ от Битрикс24 (crm.deal.productrows.set): Status={response.status_code}, Body={response.text}")

    if response.status_code != 200 or 'error' in response.json():
        app.logger.error("Не удалось установить товары в сделке. Процесс прерван.")
        return

    # --- 3. Создание документа (ДКП) в Битрикс24 ---
    template_id = DOCUMENT_TEMPLATE_MAPPING.get(deal_type_id)
    if template_id:
        app.logger.info(f"Используется шаблон ID {template_id} для типа сделки {deal_type_id}")
        document_data = {'templateId': template_id, 'entityTypeId': '2', 'entityId': deal_id}
        response = requests.post(B24_WEBHOOK_URL + 'crm.documentgenerator.document.add', json=document_data)
        app.logger.info(f"Ответ от Битрикс24 (crm.documentgenerator.document.add): Status={response.status_code}, Body={response.text}")
    else:
        app.logger.info(f"Для типа сделки '{deal_type_id}' не указан шаблон документа. Документ не будет создан.")
    
    app.logger.info(f"Фоновый процесс для сделки {deal_id} завершен.")

@app.route('/', methods=['GET', 'POST'])
def index():
    deal_id = ''
    deal_data = {}
    
    if request.method == 'POST':
        form_data = request.form.to_dict()
        app.logger.info(f"Получены данные от Битрикс24: {form_data}")
        placement_options_str = form_data.get('PLACEMENT_OPTIONS')
        if placement_options_str:
            try:
                deal_id = json.loads(placement_options_str).get('ID')
                if deal_id:
                    deal_data = get_b24_deal(deal_id)
            except json.JSONDecodeError:
                app.logger.error("Не удалось распарсить PLACEMENT_OPTIONS")
        app.logger.info(f"Извлеченный deal_id: {deal_id}")
    
    # Используем список типов сделок из .env
    deal_types = HARDCODED_DEAL_TYPES

    return render_template('index.html', deal_id=deal_id, deal_data=deal_data, deal_types=deal_types)

@app.route('/api/update_deal_type', methods=['POST'])
def update_deal_type():
    data = request.get_json()
    deal_id = data.get('deal_id')
    new_type_id = data.get('new_type_id')

    if not deal_id or not new_type_id:
        return jsonify({"error": "Необходим ID сделки и новый тип."}), 400

    update_data = {'id': deal_id, 'fields': {'TYPE_ID': new_type_id}}
    response = requests.post(B24_WEBHOOK_URL + 'crm.deal.update', json=update_data)
    
    if response.status_code == 200 and 'result' in response.json():
        app.logger.info(f"Тип сделки {deal_id} успешно обновлен на {new_type_id}.")
        return jsonify({"success": True}), 200
    else:
        app.logger.error(f"Не удалось обновить тип сделки: {response.text}")
        return jsonify({"error": "Не удалось обновить тип сделки."}), 500

@app.route('/api/create_payment_schedule', methods=['POST'])
def create_payment_schedule():
    data = request.get_json()
    app.logger.info(f"Получен запрос на создание графика: {data}")
    
    try:
        deal_id = data.get('deal_id')
        total_amount = float(data.get('total_amount'))
        monthly_payments = int(data.get('monthly_payments'))
        first_payment_date_str = data.get('first_payment_date')
        special_payments = data.get('special_payments', [])
        selected_deal_type_id = data.get('selected_deal_type_id')
        
        if not deal_id or monthly_payments <= 0 or len(special_payments) >= monthly_payments or not selected_deal_type_id:
            raise ValueError("Некорректные входные данные")
    except (ValueError, TypeError, AttributeError):
        return jsonify({"error": "Все поля формы обязательны и должны быть корректны."}), 400

    thread = threading.Thread(
        target=run_b24_process,
        args=(deal_id, total_amount, monthly_payments, first_payment_date_str, special_payments, selected_deal_type_id)
    )
    thread.start()
    
    app.logger.info("Запрос принят в обработку, отправка мгновенного ответа.")
    return jsonify({"message": "Запрос принят в обработку"}), 202


if __name__ == '__main__':
    # Убедитесь, что у вас установлена библиотека python-dotenv: pip install python-dotenv
    app.run(debug=True, port=5000)
