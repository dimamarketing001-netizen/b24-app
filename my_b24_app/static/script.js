BX24.ready(function() {
    console.log("BX24 is ready. Application logic starts.");

    // --- Инициализация ---
    flatpickr("#first_payment_date", { locale: "ru", dateFormat: "Y-m-d", altInput: true, altFormat: "d.m.Y" });

    const form = document.getElementById('payment-form');
    const addPaymentBtn = document.getElementById('add-payment-btn');
    const addPaymentRow = document.getElementById('add-payment-row');
    const errorContainer = document.getElementById('error-message-container');
    const copyAddressBtn = document.getElementById('copy-address-btn');
    const loaderOverlay = document.getElementById('loader-overlay');
    
    const requisiteContainer = document.getElementById('requisite-fields-container');
    const regAddressContainer = document.getElementById('registration-address-container');
    const physAddressContainer = document.getElementById('physical-address-container');

    let requisiteIdToUpdate = null;
    let contactIdForCreation = null;
    let specialPaymentCounter = 0;
    const MAX_SPECIAL_PAYMENTS = 3;

    // --- Вспомогательные функции ---
    function showLoader() { loaderOverlay.style.display = 'flex'; }
    function hideLoader() { loaderOverlay.style.display = 'none'; }
    function showError(message) { errorContainer.textContent = message; errorContainer.style.display = 'block'; }
    function hideError() { errorContainer.style.display = 'none'; }

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

    function renderFields(fieldsData, container, fieldDefinitions) {
        const wrapper = container.querySelector('.fields-wrapper') || container;
        wrapper.innerHTML = '';
        
        const fieldsToRender = Object.keys(fieldDefinitions);

        if (fieldsToRender.length > 0) {
            container.style.display = 'block';
            fieldsToRender.forEach(code => {
                const name = fieldDefinitions[code];
                const value = fieldsData[code] || '';
                const isError = !value.trim();
                const errorClass = isError ? 'field-error' : '';

                const fieldRow = document.createElement('div');
                fieldRow.classList.add('ui-form-row');
                fieldRow.innerHTML = `
                    <div class="ui-form-label"><div class="ui-ctl-label-text">${name}</div></div>
                    <div class="ui-form-content"><div class="ui-ctl ui-ctl-textbox ui-ctl-w100">
                        <input type="text" class="ui-ctl-element missing-field-input ${errorClass}" data-field-code="${code}" value="${value}" required>
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
        let allFilled = true;
        const inputs = document.querySelectorAll(`${containerSelector} input.missing-field-input`);
        inputs.forEach(input => {
            const value = input.value.trim();
            fields[input.dataset.fieldCode] = value;
            if (!value) {
                allFilled = false;
            }
        });
        return { fields, allFilled };
    }

    async function createSchedule() {
        const dealId = document.getElementById('deal_id').value;
        const selectedDealTypeId = document.getElementById('deal_type_select').value;
        const currentDealTypeId = document.getElementById('current_deal_type_id').value;

        if (selectedDealTypeId !== currentDealTypeId) {
            const confirmChange = await showCustomConfirm('Тип сделки в форме отличается от текущего. Изменить тип?');
            if (!confirmChange) {
                alert('Тип сделки не изменен. Отправка графика отменена.');
                return;
            }
            try {
                const updateResponse = await fetch('/api/update_deal_type', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ deal_id: dealId, new_type_id: selectedDealTypeId }),
                });
                if (!updateResponse.ok) {
                    const errorData = await updateResponse.json();
                    showError(`Ошибка при изменении типа сделки: ${errorData.error}`);
                    return;
                }
            } catch (error) {
                console.error('Ошибка при запросе на изменение типа сделки:', error);
                showError('Произошла ошибка при изменении типа сделки.');
                return;
            }
        }

        const specialPayments = Array.from(document.querySelectorAll('.special-payment-input'))
            .map(input => parseFloat(input.value)).filter(v => !isNaN(v));

        const formData = {
            deal_id: dealId,
            total_amount: document.getElementById('total_amount').value,
            monthly_payments: document.getElementById('monthly_payments').value,
            first_payment_date: document.getElementById('first_payment_date').value,
            special_payments: specialPayments,
            selected_deal_type_id: selectedDealTypeId
        };

        const response = await fetch('/api/create_payment_schedule', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(formData),
        });
        if (response.ok) {
            BX24.closeApplication();
        } else {
            const errorData = await response.json();
            showError(`Ошибка: ${errorData.error}`);
        }
    }

    // --- Главный обработчик формы ---
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        hideError();
        showLoader();

        try {
            // --- ШАГ А: СОХРАНЕНИЕ (если нужно) ---
            const areFieldsRendered = document.querySelectorAll('.missing-field-input').length > 0;
            if (areFieldsRendered) {
                const requisiteData = collectFields('#requisite-fields-container');
                const registrationAddressData = collectFields('#registration-address-container');
                const physicalAddressData = collectFields('#physical-address-container');

                if (!requisiteData.allFilled || !registrationAddressData.allFilled || !physicalAddressData.allFilled) {
                    showError("Пожалуйста, заполните все обязательные поля.");
                    document.querySelectorAll('.missing-field-input').forEach(input => {
                        if (!input.value.trim()) input.classList.add('field-error');
                    });
                    hideLoader();
                    return;
                }

                const updateRes = await fetch('/api/update_fields', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        requisite_id: requisiteIdToUpdate, 
                        contact_id: contactIdForCreation,
                        requisite_fields: requisiteData.fields,
                        registration_address: registrationAddressData.fields,
                        physical_address: physicalAddressData.fields
                    }),
                });

                if (!updateRes.ok) {
                    showError("Не удалось сохранить данные. Попробуйте еще раз.");
                    hideLoader();
                    return;
                }
            }

            // --- ШАГ Б: ПРОВЕРКА ---
            const dealId = document.getElementById('deal_id').value;
            const checkRes = await fetch('/api/check_fields', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ deal_id: dealId }),
            });

            if (!checkRes.ok) {
                const errorData = await checkRes.json();
                showError(errorData.error || "Не удалось проверить поля в Битрикс24.");
                hideLoader();
                return;
            }

            const checkData = await checkRes.json();

            // --- ШАГ В: РЕШЕНИЕ ---
            if (checkData.is_complete) {
                // Все хорошо, создаем график
                requisiteContainer.innerHTML = '';
                regAddressContainer.style.display = 'none';
                physAddressContainer.style.display = 'none';
                hideError();
                await createSchedule();
            } else {
                // Показываем поля для дозаполнения
                requisiteIdToUpdate = checkData.requisite_id;
                contactIdForCreation = checkData.contact_id;
                const message = !requisiteIdToUpdate ? 
                    "У контакта нет реквизитов. Пожалуйста, заполните все поля для их создания." :
                    "Не заполнены все обязательные поля. Пожалуйста, заполните их и нажмите 'Сформировать' еще раз.";
                showError(message);

                const REQ_FIELDS_DEF = {"RQ_LAST_NAME": "Фамилия", "RQ_FIRST_NAME": "Имя", "RQ_SECOND_NAME": "Отчество", "RQ_IDENT_DOC_SER": "Серия паспорта", "RQ_IDENT_DOC_NUM": "Номер паспорта", "RQ_IDENT_DOC_ISSUED_BY": "Кем выдан паспорт", "RQ_IDENT_DOC_DATE": "Дата выдачи паспорта"};
                const ADDR_FIELDS_DEF = {"COUNTRY": "Страна", "PROVINCE": "Регион/Область", "CITY": "Город", "ADDRESS_1": "Улица, дом", "ADDRESS_2": "Квартира", "POSTAL_CODE": "Индекс"};

                renderFields(checkData.data.requisite_fields, requisiteContainer, REQ_FIELDS_DEF);
                renderFields(checkData.data.registration_address, regAddressContainer, ADDR_FIELDS_DEF);
                renderFields(checkData.data.physical_address, physAddressContainer, ADDR_FIELDS_DEF);
            }

        } catch (error) {
            showError('Произошла критическая ошибка. Пожалуйста, проверьте консоль.');
            console.error(error);
        } finally {
            hideLoader();
        }
    });

    // --- Остальные обработчики ---
    document.addEventListener('input', function(event) {
        if (event.target.classList.contains('missing-field-input')) {
            if (event.target.value.trim()) {
                event.target.classList.remove('field-error');
            }
        }
    });

    copyAddressBtn.addEventListener('click', () => {
        const regInputs = document.querySelectorAll('#registration-address-container input.missing-field-input');
        regInputs.forEach(regInput => {
            const fieldCode = regInput.dataset.fieldCode;
            const physInput = document.querySelector(`#physical-address-container input[data-field-code="${fieldCode}"]`);
            if (physInput) {
                physInput.value = regInput.value;
                if (physInput.value.trim()) {
                    physInput.classList.remove('field-error');
                }
            }
        });
    });
    
    addPaymentBtn.addEventListener('click', () => {
        if (specialPaymentCounter >= MAX_SPECIAL_PAYMENTS) return;
        specialPaymentCounter++;
        const newPaymentRow = document.createElement('div');
        newPaymentRow.classList.add('ui-form-row');
        newPaymentRow.innerHTML = `
            <div class="ui-form-label"><div class="ui-ctl-label-text">Сумма ${specialPaymentCounter}-го платежа</div></div>
            <div class="ui-form-content"><div class="ui-ctl ui-ctl-textbox ui-ctl-w100"><input type="number" class="ui-ctl-element special-payment-input" required></div></div>
        `;
        addPaymentRow.parentNode.insertBefore(newPaymentRow, addPaymentRow);
        if (specialPaymentCounter >= MAX_SPECIAL_PAYMENTS) addPaymentBtn.style.display = 'none';
    });
});
