// Весь код приложения должен выполняться после инициализации API Битрикс24
BX24.init(function() {
    // --- НАЧАЛО БЛОКА ПОЛНОГО ЛОГИРОВАНИЯ UI ---
    console.group("--- Диагностика UI Битрикс24 ---");

    console.log(`Время инициализации: ${new Date().toISOString()}`);
    
    // 1. Проверяем глобальный объект BX, который должен быть всегда
    if (typeof BX !== 'undefined') {
        console.log("✅ Глобальный объект BX найден.", BX);
    } else {
        console.error("❌ Критическая ошибка: Глобальный объект BX не найден!");
    }

    // 2. Проверяем классы на теге <body>. Портал должен добавлять свои классы.
    console.log(`Классы на <body>: "${document.body.className}"`);
    if (!document.body.className.includes('template-bitrix24')) {
        console.warn("⚠️ Предупреждение: на <body> отсутствует класс 'template-bitrix24'. Стили могут не применяться.");
    }

    // 3. Выводим список ВСЕХ подключенных таблиц стилей
    console.log(`Найдено таблиц стилей: ${document.styleSheets.length}`);
    const styleSheets = [];
    for (let i = 0; i < document.styleSheets.length; i++) {
        const href = document.styleSheets[i].href;
        if (href) {
            styleSheets.push(href);
        } else {
            styleSheets.push("(встроенный стиль, без href)");
        }
    }
    console.table(styleSheets);

    const hasUiCore = styleSheets.some(href => href.includes('ui-core'));
    if (hasUiCore) {
        console.log("✅ Основной бандл стилей 'ui-core' найден.");
    } else {
        console.error("❌ Критическая ошибка: Основной бандл стилей 'ui-core' НЕ найден. Интерфейс не будет работать.");
    }

    console.groupEnd();
    // --- КОНЕЦ БЛОКА ЛОГИРОВАНИЯ ---


    // Ваш основной код приложения
    console.log("BX24 initialized. Application logic starts.");

    const form = document.getElementById('payment-form');
    const dealIdInput = document.getElementById('deal_id');
    const currentDealTypeIdInput = document.getElementById('current_deal_type_id');
    const dealTypeSelect = document.getElementById('deal_type_select');
    const addPaymentBtn = document.getElementById('add-payment-btn');
    const specialPaymentsContainer = document.getElementById('special-payments-container');
    let specialPaymentCounter = 0;
    const MAX_SPECIAL_PAYMENTS = 3;

    addPaymentBtn.addEventListener('click', () => {
        if (specialPaymentCounter >= MAX_SPECIAL_PAYMENTS) {
            return;
        }

        specialPaymentCounter++;
        const newPaymentRow = document.createElement('div');
        newPaymentRow.classList.add('ui-form-row');
        newPaymentRow.innerHTML = `
            <div class="ui-form-label">
                <div class="ui-ctl-label-text">Сумма ${specialPaymentCounter}-го платежа</div>
            </div>
            <div class="ui-form-content">
                <div class="ui-ctl ui-ctl-textbox ui-ctl-w100">
                    <input type="number" class="ui-ctl-element special-payment-input" required>
                </div>
            </div>
        `;
        specialPaymentsContainer.appendChild(newPaymentRow);

        if (specialPaymentCounter >= MAX_SPECIAL_PAYMENTS) {
            addPaymentBtn.disabled = true;
        }
    });

    form.addEventListener('submit', async (event) => {
        event.preventDefault();

        const selectedDealTypeId = dealTypeSelect.value;
        const currentDealTypeId = currentDealTypeIdInput.value;
        const dealId = dealIdInput.value;

        if (selectedDealTypeId !== currentDealTypeId) {
            const confirmChange = await new Promise(resolve => {
                BX24.callMethod(
                    'ui.dialogs.messagebox.show',
                    {
                        message: 'Тип сделки в форме отличается от текущего в сделке. Изменить тип сделки?',
                        buttons: BX24.UI.Dialogs.MessageBoxButtons.YES_NO,
                        onYes: () => resolve(true),
                        onNo: () => resolve(false)
                    }
                );
            });

            if (confirmChange) {
                try {
                    const updateResponse = await fetch('/api/update_deal_type', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ deal_id: dealId, new_type_id: selectedDealTypeId }),
                    });
                    if (!updateResponse.ok) {
                        const errorData = await updateResponse.json();
                        alert(`Ошибка при изменении типа сделки: ${errorData.error}`);
                        return;
                    }
                } catch (error) {
                    console.error('Ошибка при запросе на изменение типа сделки:', error);
                    alert('Произошла ошибка при изменении типа сделки.');
                    return;
                }
            } else {
                alert('Тип сделки не изменен. Отправка графика отменена.');
                return;
            }
        }

        const specialPayments = [];
        document.querySelectorAll('.special-payment-input').forEach(input => {
            if (input.value) {
                specialPayments.push(parseFloat(input.value));
            }
        });

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
                alert(`Ошибка: ${errorData.error}`);
            }
        } catch (error) {
            console.error('Объект ошибки из блока catch:', error);
            alert('Произошла ошибка при отправке данных.');
        }
    });
});
