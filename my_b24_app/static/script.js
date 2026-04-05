BX24.ready(function() {
    console.log("BX24 is ready. Application logic starts.");

    // --- Инициализация ---
    flatpickr("#first_payment_date", { locale: "ru", dateFormat: "Y-m-d", altInput: true, altFormat: "d.m.Y" });

    const form = document.getElementById('payment-form');
    const addPaymentBtn = document.getElementById('add-payment-btn');
    const addPaymentRow = document.getElementById('add-payment-row');
    const errorContainer = document.getElementById('error-message-container');
    const copyAddressBtn = document.getElementById('copy-address-btn');
    
    const requisiteContainer = document.getElementById('requisite-fields-container');
    const regAddressContainer = document.getElementById('registration-address-container');
    const physAddressContainer = document.getElementById('physical-address-container');

    let specialPaymentCounter = 0;
    const MAX_SPECIAL_PAYMENTS = 3;
    let requisiteIdToUpdate = null;
    let contactIdForCreation = null;

    // --- Логика модального окна ---
    const modal = document.getElementById('custom-modal');
    const modalText = document.getElementById('modal-text');
    const confirmBtn = document.getElementById('modal-confirm-btn');
    const cancelBtn = document.getElementById('modal-cancel-btn');

    function showCustomConfirm(text) {
        return new Promise(resolve => {
            modalText.textContent = text;
            modal.style.display = 'flex';
            confirmBtn.onclick = () => { modal.style.display = 'none'; resolve(true); };
            cancelBtn.onclick = () => { modal.style.display = 'none'; resolve(false); };
        });
    }

    // --- Основные функции ---
    function showError(message) {
        errorContainer.textContent = message;
        errorContainer.style.display = 'block';
    }

    function hideError() {
        errorContainer.style.display = 'none';
    }

    function renderMissingFields(fields, container) {
        const wrapper = container.querySelector('.fields-wrapper') || container;
        wrapper.innerHTML = '';
        if (fields.length > 0) {
            container.style.display = 'block';
            fields.forEach(field => {
                const fieldRow = document.createElement('div');
                fieldRow.classList.add('ui-form-row');
                fieldRow.innerHTML = `
                    <div class="ui-form-label"><div class="ui-ctl-label-text">${field.name}</div></div>
                    <div class="ui-form-content"><div class="ui-ctl ui-ctl-textbox ui-ctl-w100">
                        <input type="text" class="ui-ctl-element missing-field-input" data-field-code="${field.code}" required>
                    </div></div>
                `;
                wrapper.appendChild(fieldRow);
            });
        } else {
            container.style.display = 'none';
        }
    }
    
    function collectFields(containerSelector) {
        const fields = {};
        document.querySelectorAll(`${containerSelector} .missing-field-input`).forEach(input => {
            if (input.value.trim()) {
                fields[input.dataset.fieldCode] = input.value.trim();
            }
        });
        return fields;
    }

    async function handleFormSubmit() {
        hideError();
        const dealId = document.getElementById('deal_id').value;

        // --- ЭТАП 1: Сбор и отправка данных для обновления ---
        const requisiteFields = collectFields('#requisite-fields-container');
        const registrationAddress = collectFields('#registration-address-container');
        const physicalAddress = collectFields('#physical-address-container');

        if (Object.keys(requisiteFields).length > 0 || Object.keys(registrationAddress).length > 0 || Object.keys(physicalAddress).length > 0) {
            const updateRes = await fetch('/api/update_fields', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    requisite_id: requisiteIdToUpdate, 
                    contact_id: contactIdForCreation,
                    requisite_fields: requisiteFields,
                    registration_address: registrationAddress,
                    physical_address: physicalAddress
                }),
            });

            if (!updateRes.ok) {
                showError("Не удалось сохранить данные. Попробуйте еще раз.");
                return;
            }
        }

        // --- ЭТАП 2: Повторная проверка полей ---
        const checkRes = await fetch('/api/check_fields', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deal_id: dealId }),
        });

        if (!checkRes.ok) {
            showError("Не удалось проверить поля в Битрикс24.");
            return;
        }

        const checkData = await checkRes.json();
        requisiteIdToUpdate = checkData.requisite_id;
        contactIdForCreation = checkData.contact_id;

        renderMissingFields(checkData.missing_requisite_fields, requisiteContainer);
        renderMissingFields(checkData.missing_registration_fields, regAddressContainer);
        renderMissingFields(checkData.missing_physical_fields, physAddressContainer);

        if (checkData.missing_requisite_fields.length > 0 || checkData.missing_registration_fields.length > 0 || checkData.missing_physical_fields.length > 0) {
            showError("Не заполнены все обязательные поля. Пожалуйста, заполните их и нажмите 'Сформировать' еще раз.");
            return;
        }

        // --- ЭТАП 3: Основная логика (если все поля заполнены) ---
        // ... (логика смены типа сделки и создания графика)
    }

    // --- Привязка обработчиков ---
    copyAddressBtn.addEventListener('click', () => {
        const regInputs = document.querySelectorAll('#registration-address-container input.missing-field-input');
        regInputs.forEach(regInput => {
            const fieldCode = regInput.dataset.fieldCode;
            const physInput = document.querySelector(`#physical-address-container input[data-field-code="${fieldCode}"]`);
            if (physInput) {
                physInput.value = regInput.value;
            }
        });
    });
    
    addPaymentBtn.addEventListener('click', () => {
        // ... (без изменений)
    });

    form.addEventListener('submit', (event) => {
        event.preventDefault();
        handleFormSubmit();
    });

    // Первичная проверка при загрузке
    handleFormSubmit();
});
