from flask import Flask, request, jsonify, render_template
import requests
import datetime
import logging
import json
import threading
import os
from dotenv import load_dotenv

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), '..', '.env'))

logging.basicConfig(level=logging.INFO)
app = Flask(__name__, static_folder='static', template_folder='static')

B24_WEBHOOK_URL = os.getenv("B24_WEBHOOK_URL")
try:
    DOCUMENT_TEMPLATE_MAPPING = json.loads(os.getenv("DOCUMENT_TEMPLATE_MAPPING", "{}"))
    HARDCODED_DEAL_TYPES = json.loads(os.getenv("HARDCODED_DEAL_TYPES", "[]"))
except (json.JSONDecodeError, TypeError):
    app.logger.error("Ошибка при загрузке конфигурации из .env.")
    DOCUMENT_TEMPLATE_MAPPING = {}
    HARDCODED_DEAL_TYPES = []

if not B24_WEBHOOK_URL:
    app.logger.critical("Критическая ошибка: B24_WEBHOOK_URL не найден!")

# --- СПИСОК ОБЯЗАТЕЛЬНЫХ ПОЛЕЙ РЕКВИЗИТОВ ---
REQUIRED_REQUISITE_FIELDS = {
    "RQ_LAST_NAME": "Фамилия",
    "RQ_FIRST_NAME": "Имя",
    "RQ_SECOND_NAME": "Отчество",
    "RQ_IDENT_DOC_SER": "Серия паспорта",
    "RQ_IDENT_DOC_NUM": "Номер паспорта",
    "RQ_IDENT_DOC_ISSUED_BY": "Кем выдан паспорт",
    "RQ_IDENT_DOC_DATE": "Дата выдачи паспорта",
    "RQ_ADDR": "Адрес регистрации (одной строкой)", # Специальный ключ для адреса
}

def b24_call_method(method, params):
    try:
        url = B24_WEBHOOK_URL + method
        response = requests.post(url, json=params)
        response.raise_for_status()
        return response.json()
    except requests.exceptions.RequestException as e:
        app.logger.error(f"Ошибка при вызове метода {method}: {e}")
        return None
    except json.JSONDecodeError as e:
        app.logger.error(f"Ошибка декодирования JSON от метода {method}: {e}")
        return None

@app.route('/api/check_fields', methods=['POST'])
def check_fields():
    data = request.get_json()
    deal_id = data.get('deal_id')
    if not deal_id:
        return jsonify({"error": "Не передан ID сделки"}), 400

    deal_data = b24_call_method('crm.deal.get', {'id': deal_id})
    if not deal_data or 'result' not in deal_data:
        return jsonify({"error": "Не удалось получить данные по сделке"}), 500
    
    contact_id = deal_data['result'].get('CONTACT_ID')
    if not contact_id:
        return jsonify({"error": "В сделке не указан контакт"}), 400

    requisite_list = b24_call_method('crm.requisite.list', {
        'filter': {'ENTITY_TYPE_ID': 3, 'ENTITY_ID': contact_id},
        'select': ['ID', 'RQ_ADDR']
    })
    if not requisite_list or not requisite_list.get('result'):
        return jsonify({"error": "У контакта нет реквизитов. Пожалуйста, создайте их."}), 400
    
    requisite_id = requisite_list['result'][0]['ID']
    
    requisite_data = b24_call_method('crm.requisite.get', {'id': requisite_id})
    if not requisite_data or 'result' not in requisite_data:
        return jsonify({"error": "Не удалось получить данные реквизитов"}), 500

    missing_fields = []
    for field_code, field_name in REQUIRED_REQUISITE_FIELDS.items():
        if field_code == "RQ_ADDR":
            # Особая проверка для адреса
            addr_data = requisite_data['result'].get('RQ_ADDR')
            # Ищем адрес регистрации (TYPE_ID = 6)
            reg_address = next((addr for addr in addr_data.values() if addr.get('TYPE_ID') == 6), None)
            if not reg_address or not reg_address.get('ADDRESS_1'):
                missing_fields.append({"code": "RQ_ADDR", "name": field_name})
        elif not requisite_data['result'].get(field_code) or not str(requisite_data['result'].get(field_code)).strip():
            missing_fields.append({"code": field_code, "name": field_name})
            
    return jsonify({"missing_fields": missing_fields, "requisite_id": requisite_id})

@app.route('/api/update_fields', methods=['POST'])
def update_fields():
    data = request.get_json()
    requisite_id = data.get('requisite_id')
    fields_to_update = data.get('fields')

    if not requisite_id or not fields_to_update:
        return jsonify({"error": "Не переданы ID реквизита или поля для обновления"}), 400

    # Отделяем адрес от остальных полей
    address_str = fields_to_update.pop('RQ_ADDR', None)
    
    # Обновляем обычные поля
    if fields_to_update:
        b24_call_method('crm.requisite.update', {'id': requisite_id, 'fields': fields_to_update})

    # Обновляем адрес, если он был передан
    if address_str:
        # Сначала нужно найти ID адреса регистрации
        addr_list = b24_call_method('crm.address.list', {'filter': {'ENTITY_ID': requisite_id, 'ENTITY_TYPE_ID': 8, 'TYPE_ID': 6}})
        addr_id = addr_list.get('result', [{}])[0].get('ID') if addr_list.get('result') else None
        
        addr_fields = {'TYPE_ID': 6, 'ENTITY_ID': requisite_id, 'ENTITY_TYPE_ID': 8, 'ADDRESS_1': address_str}
        if addr_id:
            b24_call_method('crm.address.update', {'id': addr_id, 'fields': addr_fields})
        else:
            b24_call_method('crm.address.add', {'fields': addr_fields})

    return jsonify({"success": True}), 200

# ... (остальной код без изменений) ...
def get_b24_deal(deal_id):
    if not deal_id: return {}
    return b24_call_method('crm.deal.get', {'id': deal_id}).get('result', {})

def run_b24_process(deal_id, total_amount, monthly_payments, first_payment_date_str, special_payments, deal_type_id):
    app.logger.info(f"Фоновый процесс запущен для сделки {deal_id}")
    product_rows = []
    first_payment_date = datetime.datetime.strptime(first_payment_date_str, '%Y-%m-%d').date()
    
    remaining_amount = total_amount
    remaining_payments_count = monthly_payments

    for i, special_amount in enumerate(special_payments):
        payment_date = first_payment_date + datetime.timedelta(days=30 * i)
        product_rows.append({"PRODUCT_NAME": payment_date.strftime('%d.%m.%Y'), "PRICE": special_amount, "QUANTITY": 1})
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
            product_rows.append({"PRODUCT_NAME": payment_date.strftime('%d.%m.%Y'), "PRICE": round(current_payment, 2), "QUANTITY": 1})

    b24_call_method('crm.deal.productrows.set', {'id': deal_id, 'rows': product_rows})
    
    template_id = DOCUMENT_TEMPLATE_MAPPING.get(deal_type_id)
    if template_id:
        b24_call_method('crm.documentgenerator.document.add', {'templateId': template_id, 'entityTypeId': '2', 'entityId': deal_id})
    else:
        app.logger.info(f"Для типа сделки '{deal_type_id}' не указан шаблон документа.")
    
    app.logger.info(f"Фоновый процесс для сделки {deal_id} завершен.")

@app.route('/', methods=['GET', 'POST'])
def index():
    deal_id = ''
    deal_data = {}
    if request.method == 'POST':
        form_data = request.form.to_dict()
        placement_options_str = form_data.get('PLACEMENT_OPTIONS')
        if placement_options_str:
            try:
                deal_id = json.loads(placement_options_str).get('ID')
                if deal_id:
                    deal_data = get_b24_deal(deal_id)
            except json.JSONDecodeError:
                app.logger.error("Не удалось распарсить PLACEMENT_OPTIONS")
    
    return render_template('index.html', deal_id=deal_id, deal_data=deal_data, deal_types=HARDCODED_DEAL_TYPES)

@app.route('/api/update_deal_type', methods=['POST'])
def update_deal_type():
    data = request.get_json()
    deal_id = data.get('deal_id')
    new_type_id = data.get('new_type_id')

    if not deal_id or not new_type_id:
        return jsonify({"error": "Необходим ID сделки и новый тип."}), 400

    update_result = b24_call_method('crm.deal.update', {'id': deal_id, 'fields': {'TYPE_ID': new_type_id}})
    
    if update_result and 'result' in update_result:
        return jsonify({"success": True}), 200
    else:
        app.logger.error(f"Не удалось обновить тип сделки: {update_result}")
        return jsonify({"error": "Не удалось обновить тип сделки."}), 500

@app.route('/api/create_payment_schedule', methods=['POST'])
def create_payment_schedule():
    data = request.get_json()
    try:
        deal_id = data.get('deal_id')
        total_amount = float(data.get('total_amount'))
        monthly_payments = int(data.get('monthly_payments'))
        first_payment_date_str = data.get('first_payment_date')
        special_payments = data.get('special_payments', [])
        selected_deal_type_id = data.get('selected_deal_type_id')
        
        if not all([deal_id, total_amount, monthly_payments, first_payment_date_str, selected_deal_type_id]):
            raise ValueError("Не все основные поля заполнены")
    except (ValueError, TypeError, AttributeError):
        return jsonify({"error": "Все поля формы обязательны и должны быть корректны."}), 400

    thread = threading.Thread(
        target=run_b24_process,
        args=(deal_id, total_amount, monthly_payments, first_payment_date_str, special_payments, selected_deal_type_id)
    )
    thread.start()
    
    return jsonify({"message": "Запрос принят в обработку"}), 202

if __name__ == '__main__':
    app.run(debug=True, port=5000)
