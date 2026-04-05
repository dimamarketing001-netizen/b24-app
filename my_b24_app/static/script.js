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
    
    // --- ПЕРЕМЕННАЯ-ФЛАГ (МЕТКА) ---
    let fieldsAreDisplayed = false;

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
    
    // --- Новая функция для применения масок ---
    function applyMasks() {
        const maskPatterns = {
            'RQ_BIRTHDATE': { mask: Date, pattern: 'Y-`m-`d', lazy: false, format: date => date.toISOString().split('T')[0], parse: str => new Date(str) },
            'RQ_IDENT_DOC_DATE': { mask: Date, pattern: 'Y-`m-`d', lazy: false, format: date => date.toISOString().split('T')[0], parse: str => new Date(str) },
            'RQ_IDENT_DOC_SER': { mask: '00 00' },
            'RQ_IDENT_DOC_NUM': { mask: '000000' },
            'RQ_IDENT_DOC_DEP_CODE': { mask: '000-000' }
        };

        Object.keys(maskPatterns).forEach(fieldCode => {
            const input = document.querySelector(`[data-field-code="${fieldCode}"]`);
            if (input) {
                IMask(input, maskPatterns[fieldCode]);
            }
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
            // Вызываем применение масок после отрисовки полей
            applyMasks();
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
            
            showLoader(); 
            try {
                const updateResponse = await fetch('/api/update_deal_type', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ deal_id: dealId, new_type_id: selectedDealTypeId }),
                });
                if (!updateResponse.ok) {
                    const errorData = await updateResponse.json();
                    showError(`Ошибка при изменении типа сделки: ${errorData.error}`);
                    hideLoader();
                    return;
                }
            } catch (error) {
                console.error('Ошибка при запросе на изменение типа сделки:', error);
                showError('Произошла ошибка при изменении типа сделки.');
                hideLoader();
                return;
            }
        } else {
            showLoader(); 
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

        try {
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
        } finally {
            hideLoader(); 
        }
    }

    // --- Главный обработчик формы ---
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        hideError();
        
        try {
            if (fieldsAreDisplayed) {
                showLoader(); 
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
                hideLoader(); 
            }
            
            showLoader(); 
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
            hideLoader(); 

            const checkData = await checkRes.json();

            if (checkData.is_complete) {
                requisiteContainer.innerHTML = '';
                regAddressContainer.style.display = 'none';
                physAddressContainer.style.display = 'none';
                hideError();
                fieldsAreDisplayed = false; 
                
                await createSchedule(); 
            } else {
                requisiteIdToUpdate = checkData.requisite_id;
                contactIdForCreation = checkData.contact_id;
                const message = !requisiteIdToUpdate ? 
                    "У контакта нет реквизитов. Пожалуйста, заполните все поля для их создания." :
                    "Не заполнены все обязательные поля. Пожалуйста, заполните их и нажмите 'Сформировать' еще раз.";
                showError(message);

                renderFields(checkData.data.requisite_fields, requisiteContainer, checkData.definitions.requisite_fields);
                renderFields(checkData.data.registration_address, regAddressContainer, checkData.definitions.address_fields);
                renderFields(checkData.data.physical_address, physAddressContainer, checkData.definitions.address_fields);
                
                fieldsAreDisplayed = true; 
            }

        } catch (error) {
            showError('Произошла критическая ошибка. Пожалуйста, проверьте консоль.');
            console.error(error);
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
