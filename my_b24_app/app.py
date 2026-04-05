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

REQUIRED_REQUISITE_FIELDS = {
    "RQ_LAST_NAME": "Фамилия", "RQ_FIRST_NAME": "Имя", "RQ_SECOND_NAME": "Отчество",
    "RQ_IDENT_DOC_SER": "Серия паспорта", "RQ_IDENT_DOC_NUM": "Номер паспорта",
    "RQ_IDENT_DOC_ISSUED_BY": "Кем выдан паспорт", "RQ_IDENT_DOC_DATE": "Дата выдачи паспорта",
}
REQUIRED_ADDRESS_FIELDS = {
    "COUNTRY": "Страна", "PROVINCE": "Регион/Область", "CITY": "Город",
    "ADDRESS_1": "Улица, дом", "ADDRESS_2": "Квартира", "POSTAL_CODE": "Индекс",
}

def b24_call_method(method, params):
    # ... (без изменений)
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

def get_entity_data(source, fields):
    """Извлекает данные полей из источника и проверяет их полноту."""
    data = {}
    is_complete = True
    for code in fields.keys():
        value = source.get(code, '')
        # Убедимся, что value это строка перед вызовом strip()
        value_str = str(value) if value is not None else ''
        data[code] = value_str
        if not value_str.strip():
            is_complete = False
    return data, is_complete

@app.route('/api/check_fields', methods=['POST'])
def check_fields():
    data = request.get_json()
    deal_id = data.get('deal_id')
    if not deal_id: return jsonify({"error": "Не передан ID сделки"}), 400

    deal_data = b24_call_method('crm.deal.get', {'id': deal_id}).get('result', {})
    contact_id = deal_data.get('CONTACT_ID')
    if not contact_id: return jsonify({"error": "В сделке не указан контакт"}), 400

    requisite_list = b24_call_method('crm.requisite.list', {'filter': {'ENTITY_TYPE_ID': 3, 'ENTITY_ID': contact_id}, 'select': ['ID']})
    
    is_fully_complete = True
    response_data = {
        "requisite_id": None, "contact_id": contact_id,
        "data": {"requisite_fields": {}, "registration_address": {}, "physical_address": {}}
    }

    if not requisite_list or not requisite_list.get('result'):
        is_fully_complete = False
        response_data["data"]["requisite_fields"] = {code: "" for code in REQUIRED_REQUISITE_FIELDS}
        response_data["data"]["registration_address"] = {code: "" for code in REQUIRED_ADDRESS_FIELDS}
        response_data["data"]["physical_address"] = {code: "" for code in REQUIRED_ADDRESS_FIELDS}
    else:
        requisite_id = requisite_list['result'][0]['ID']
        response_data["requisite_id"] = requisite_id
        
        requisite_data = b24_call_method('crm.requisite.get', {'id': requisite_id}).get('result', {})
        all_addresses = b24_call_method('crm.address.list', {'filter': {'ENTITY_ID': requisite_id, 'ENTITY_TYPE_ID': 8}}).get('result', [])
        
        reg_address_data = next((addr for addr in all_addresses if addr.get('TYPE_ID') == 6), {})
        phys_address_data = next((addr for addr in all_addresses if addr.get('TYPE_ID') == 1), {})

        req_fields, req_complete = get_entity_data(requisite_data, REQUIRED_REQUISITE_FIELDS)
        reg_addr_fields, reg_addr_complete = get_entity_data(reg_address_data, REQUIRED_ADDRESS_FIELDS)
        phys_addr_fields, phys_addr_complete = get_entity_data(phys_address_data, REQUIRED_ADDRESS_FIELDS)

        response_data["data"]["requisite_fields"] = req_fields
        response_data["data"]["registration_address"] = reg_addr_fields
        response_data["data"]["physical_address"] = phys_addr_fields
        
        if not (req_complete and reg_addr_complete and phys_addr_complete):
            is_fully_complete = False

    response_data["is_complete"] = is_fully_complete
    return jsonify(response_data)

@app.route('/api/update_fields', methods=['POST'])
def update_fields():
    # ... (логика обновления остается без изменений)
    data = request.get_json()
    requisite_id = data.get('requisite_id')
    contact_id = data.get('contact_id')
    
    requisite_fields = data.get('requisite_fields', {})
    reg_addr_fields = data.get('registration_address', {})
    phys_addr_fields = data.get('physical_address', {})

    if not (requisite_id or contact_id): return jsonify({"error": "Не передан ID"}), 400

    target_requisite_id = requisite_id

    if not requisite_id: # Создаем реквизиты
        requisite_fields.update({"ENTITY_TYPE_ID": 3, "ENTITY_ID": contact_id, "PRESET_ID": 5, "NAME": "Физ. лицо"})
        add_result = b24_call_method('crm.requisite.add', {'fields': requisite_fields})
        if not add_result or not add_result.get('result'): return jsonify({"error": "Не удалось создать реквизиты"}), 500
        target_requisite_id = add_result['result']
    elif requisite_fields: # Обновляем реквизиты
        b24_call_method('crm.requisite.update', {'id': target_requisite_id, 'fields': requisite_fields})

    # Обновляем/создаем адреса
    for addr_type_id, addr_fields in [(6, reg_addr_fields), (1, phys_addr_fields)]:
        if not addr_fields: continue
        
        addr_list = b24_call_method('crm.address.list', {'filter': {'ENTITY_ID': target_requisite_id, 'ENTITY_TYPE_ID': 8, 'TYPE_ID': addr_type_id}})
        addr_id = addr_list.get('result', [{}])[0].get('ID') if addr_list.get('result') else None
        
        addr_fields.update({'TYPE_ID': addr_type_id, 'ENTITY_ID': target_requisite_id, 'ENTITY_TYPE_ID': 8})
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
