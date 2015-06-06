
// this file contains the screens definitions. Screens are the
// content of the right pane of the pos, containing the main functionalities. 
// screens are contained in the PosWidget, in pos_widget.js
// all screens are present in the dom at all time, but only one is shown at the
// same time. 
//
// transition between screens is made possible by the use of the screen_selector,
// which is responsible of hiding and showing the screens, as well as maintaining
// the state of the screens between different orders.
//
// all screens inherit from ScreenWidget. the only addition from the base widgets
// are show() and hide() which shows and hides the screen but are also used to 
// bind and unbind actions on widgets and devices. The screen_selector guarantees
// that only one screen is shown at the same time and that show() is called after all
// hide()s

function openerp_pos_ncf_screens(instance, module){ //module is instance.point_of_sale
    var QWeb = instance.web.qweb,
    _t = instance.web._t;

    module.PendingOrderListScreenWidget = module.ScreenWidget.extend({
        template: 'PendingOrderListScreenWidget',

        next_screen: 'products',
        previous_screen: 'products',

        show_leftpane: false,
        auto_back: true,

        init: function(parent, options){
            this._super(parent, options);
        },

        show: function(){
            var self = this;
            this._super();

            this.renderElement();
            this.details_visible = false;
            this.old_order = null;
            this.new_order = this.old_order;

            this.$('.back').click(function() {
                self.pos_widget.screen_selector.set_current_screen(self.previous_screen);
            });

            this.$('.next').click(function() {
                self.set_pending_order();
                self.old_order = self.new_order;
                self.pos_widget.screen_selector.set_current_screen(self.next_screen);
            });

            var orders = this.pos.db.get_pending_orders_sorted(1000);
            this.render_list(orders);

            this.reload_pending_orders();

            if( this.old_order ){
                this.display_order_details('show',this.old_order,0);
            }

            this.$('.order-list-contents').delegate('.order-line','click',function(event){
                self.line_select(event, $(this), parseInt($(this).data('id')));
            });

            var search_timeout = null;

            if(this.pos.config.iface_vkeyboard && this.pos_widget.onscreen_keyboard){
                this.pos_widget.onscreen_keyboard.connect(this.$('.searchbox input'));
            }

            this.$('.searchbox input').on('keyup',function(event){
                clearTimeout(search_timeout);

                var query = this.value;

                search_timeout = setTimeout(function(){
                    self.perform_search(query,event.which === 13);
                },70);
            });

            this.$('.searchbox .search-clear').click(function(){
                self.clear_search();
            });
        },
        barcode_client_action: function(code){
            if (this.editing_client) {
                this.$('.detail.barcode').val(code.code);
            } else if (this.pos.db.get_partner_by_ean13(code.code)) {
                this.display_order_details('show',this.pos.db.get_partner_by_ean13(code.code));
            }
        },
        perform_search: function(query, associate_result){
            if(query){
                var orders = this.pos.db.search_pending_order(query);
                this.display_order_details('hide');
                if ( associate_result && orders.length === 1){
                    this.new_order = orders[0];
                    this.set_pending_order();
                    this.pos_widget.screen_selector.back();
                }
                this.render_list(orders);
            }else{
                var orders = this.pos.db.get_pending_orders_sorted(1000);
                this.render_list(orders);
            }
        },
        clear_search: function(){
            var orders = this.pos.db.get_pending_orders_sorted(1000);
            this.render_list(orders);
            this.$('.searchbox input')[0].value = '';
            this.$('.searchbox input').focus();
        },
        render_list: function(orders){
            var contents = this.$el[0].querySelector('.order-list-contents');
            contents.innerHTML = "";
            for(var i = 0, len = Math.min(orders.length,1000); i < len; i++){
                if (orders[i]) {
                    var clientline_html = QWeb.render('PendingOrderLine', {widget: this, order: orders[i]});
                    var clientline = document.createElement('tbody');
                    clientline.innerHTML = clientline_html;
                    clientline = clientline.childNodes[1];

                    if (orders[i] === this.new_order) {
                        clientline.classList.add('highlight');
                    } else {
                        clientline.classList.remove('highlight');
                    }

                    contents.appendChild(clientline);
                } else {
                    console.log('Order at index [' + i + '] is NOT defined!');
                }
            }
        },
        set_pending_order: function() {
            var currentOrder = this.pos.get('selectedOrder');
            if (this.has_order_changed()) {
                currentOrder.x_express_order = this.new_order.get('order').x_express_order;
                currentOrder.get('orderLines').reset();
                currentOrder.set_immutable(false);
                var forEach = Array.prototype.forEach;
                forEach.call(this.new_order.get('orderLines').models, function(orderLine) {
                    currentOrder.addProduct(orderLine.product, {
                        quantity: orderLine.quantity,
                        price: orderLine.price,
                        discount: orderLine.discount
                    });
                });

                if ( this.new_order.get('client') ) {
                    currentOrder.set_client( this.new_order.get('client') );
                }

                currentOrder.set_immutable(true);
                currentOrder.set_pending_order_id(this.new_order.id);

                this.new_order = currentOrder;
            }
        },
        has_order_changed: function(){
            if( this.old_order && this.new_order ){
                return this.old_order.id !== this.new_order.id;
            }else{
                return !!this.old_order !== !!this.new_order;
            }
        },
        toggle_save_button: function(){
            var $button = this.$('.button.next');
            if( this.new_order ){
                if( !this.old_order){
                    $button.text(_t('Set Pending Order'));
                }else{
                    $button.text(_t('Change Pending Order'));
                }
            }else{
                $button.text(_t('Deselect Pending Order'));
            }
            $button.toggleClass('oe_hidden',!this.has_order_changed());
        },

        line_select: function(event,$line,id){
            var order = this.pos.db.get_pending_order_by_id(id);
            this.$('.order-list .lowlight').removeClass('lowlight');
            if ( $line.hasClass('highlight') ){
                $line.removeClass('highlight');
                $line.addClass('lowlight');
                this.display_order_details('hide',order);
                this.new_order = null;
                this.toggle_save_button();
            }else{
                this.$('.order-list .highlight').removeClass('highlight');
                $line.addClass('highlight');
                var y = event.pageY - $line.parent().offset().top
                this.display_order_details('show',order,y);
                this.new_order = order;
                this.toggle_save_button();
            }
        },

        // This fetches partner changes on the server, and in case of changes,
        // rerenders the affected views
        reload_pending_orders: function(){
            var self = this;
            return this.pos.load_pending_orders().then(function(){
                self.render_list(self.pos.db.get_pending_orders_sorted(1000));
            });
        },

        // Shows,hides or edit the customer details box :
        // visibility: 'show', 'hide' or 'edit'
        // partner:    the partner object to show or edit
        // clickpos:   the height of the click on the list (in pixel), used
        //             to maintain consistent scroll.
        display_order_details: function(visibility,order,clickpos){
            var self = this;
            var contents = this.$('.order-details-contents');
            var parent   = this.$('.order-list').parent();
            var scroll   = parent.scrollTop();
            var height   = contents.height();

            this.editing_client = false;
            this.uploaded_picture = null;

            if(visibility === 'show'){
                contents.empty();
                contents.append($(QWeb.render('PosTicketPending',{
                    widget: this,
                    order: order,
                    orderlines: order.get('orderLines').models
                })));

                var new_height   = contents.height();

                if(!this.details_visible){
                    if(clickpos < scroll + new_height + 20 ){
                        parent.scrollTop( clickpos - 20 );
                    }else{
                        parent.scrollTop(parent.scrollTop() + new_height);
                    }
                }else{
                    parent.scrollTop(parent.scrollTop() - height + new_height);
                }

                this.details_visible = true;
                this.toggle_save_button();
            } else if (visibility === 'hide') {
                contents.empty();
                if( height > scroll ){
                    contents.css({height:height+'px'});
                    contents.animate({height:0},400,function(){
                        contents.css({height:''});
                    });
                }else{
                    parent.scrollTop( parent.scrollTop() - height);
                }
                this.details_visible = false;
                this.toggle_save_button();
            }
        },

        close: function(){
            this._super();
        }
    });

    module.PaymentScreenWidget = module.PaymentScreenWidget.extend({

        init: function(parent, options) {
            var self = this;
            this._super(parent, options);
            this.hotkey_handler = function(event){
                //if(event.which === 13){
                //    // click en enter ejecuta la orden usando
                //    // comprobante para consumidor final (02).
                //    self.validate_order({tcf: '02'});
                //}else
                if(event.which === 27){
                    // click en escape vuelve hacia la
                    // pantalla anterior.
                    self.back();
                }
            };
        },

        show: function() {
            this._super();
            var self = this;
            var currentOrder = this.pos.get('selectedOrder');

            this.pos_widget.action_bar.destroy_buttons();

            this.add_action_button({
                label: _t('Volver'),
                icon: '/point_of_sale/static/src/img/icons/png48/go-previous.png',
                click: function(){
                    self.back();
                }
            });

            this.add_action_button({
                label: (currentOrder.x_express_order ? _t('Express') : _t('Normal')),
                name: 'validation.express',
                icon: '/pos_ncf/static/src/img/express-order.png',
                click: function (btn) {
                    btn.currentTarget.innerHTML = "<div class='icon'><img src='/pos_ncf/static/src/img/express-order.png'><div class='iconlabel'>" + (currentOrder.x_express_order ? _t('Normal') : _t('Express')) + "</div></div>";
                    currentOrder.x_express_order = !currentOrder.x_express_order;
                    self.update_payment_summary();
                    var paymentLine = currentOrder.get('paymentLines').models[0];
                    if (paymentLine.cashregister.journal.type != 'cash') {
                        currentOrder.removePaymentline(paymentLine);
                        currentOrder.addPaymentline(paymentLine.cashregister);
                    }
                }
            });

            if (currentOrder.get('paymentLines').models[0].cashregister.journal.x_pending_payment) {
                this.add_action_button({
                    label: _t('Recibir'),
                    name: 'validation',
                    icon: '/point_of_sale/static/src/img/icons/png48/invoice.png',
                    click: function () {
                        self.validate_order();
                    }
                });
            } else {
                this.add_action_button({
                    label: _t('Consumidor Final'),
                    name: 'validation',
                    icon: '/point_of_sale/static/src/img/icons/png48/invoice.png',
                    click: function () {
                        self.validate_order({tcf: '02'});
                    }
                });

                this.add_action_button({
                    label: _t('Comprobante Fiscal'),
                    name: 'cf.validation',
                    icon: '/pos_ncf/static/src/img/ncf_icon.png',
                    click: function () {
                        self.pos_widget.screen_selector.show_popup('confirm',{
                            message: _t('Seguro que desea imprimir factura con Comprobante Fiscal?'),
                            confirm: function() {
                                self.validate_order({tcf: '01'});
                            }
                        });
                    }
                });
            }

            if( this.pos.config.iface_cashdrawer ){
                this.add_action_button({
                    label: _t('Caja'),
                    name: 'cashbox',
                    icon: '/point_of_sale/static/src/img/open-cashbox.png',
                    click: function(){
                        self.pos.proxy.open_cashbox();
                    }
                });
            }

            this.update_payment_summary();
        },

        formatDate: function (date) {
            var formattedDate = "";
            formattedDate += ("00" + date.getDate()).slice(-2) + '/';
            formattedDate += ("00" + (date.getMonth() + 1)).slice(-2) + '/';
            formattedDate += date.getFullYear();
            return formattedDate;
        },


        formatDisplayDate: function (date) {
            var formattedDate = "";
            var weekday = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
            var today = new Date();
            var isToday = date.getDay() == today.getDay() && date.getMonth() == today.getMonth() && date.getYear() == today.getYear();
            formattedDate += (isToday ? 'hoy' : weekday[date.getDay()] + ' ' + date.getDate());
            return formattedDate;
        },

        formatAMPM: function (date) {
            var hours = date.getHours();
            var minutes = date.getMinutes();
            var ampm = hours >= 12 ? 'PM' : 'AM';
            hours = hours % 12;
            hours = hours ? hours : 12; // the hour '0' should be '12'
            minutes = minutes < 10 ? '0'+minutes : minutes;
            var strTime = hours + ':' + minutes + ' ' + ampm;
            return strTime;
        },
        update_payment_summary: function() {
            this._super();
            if (this.pos_widget.action_bar) {
                this.pos_widget.action_bar.set_button_disabled('cf.validation', !this.is_paid());
            }
        },

        validate_order: function(options) {
            var self = this;
            options = options || {};

            var currentOrder = this.pos.get('selectedOrder');

            if(currentOrder.get('orderLines').models.length === 0){
                this.pos_widget.screen_selector.show_popup('error',{
                    'message': _t('Empty Order'),
                    'comment': _t('There must be at least one product in your order before it can be validated')
                });
                return;
            }

            if(!this.is_paid()) {
                this.pos_widget.screen_selector.show_popup('error',{
                    'message': _t('Metodo de Pago Requerido'),
                    'comment': _t('Debe pagar para proceder con la orden.')
                });
                return;
            }

            // Client is mandatory for dry clean business.
            if(this.pos.config.x_partner_required && !currentOrder.get('client')){
                this.pos_widget.screen_selector.show_popup('error',{
                    'message': _t('Cliente Requerido'),
                    'comment': _t('Debe seleccionar un cliente para proceder con la orden.')
                });
                return;
            }

            // The exact amount must be paid if there is no cash payment method defined.
            if (Math.abs(currentOrder.getTotalTaxIncluded() - currentOrder.getPaidTotal()) > 0.00001) {
                var cash = false;
                for (var i = 0; i < this.pos.cashregisters.length; i++) {
                    cash = cash || (this.pos.cashregisters[i].journal.type === 'cash');
                }
                if (!cash) {
                    this.pos_widget.screen_selector.show_popup('error',{
                        message: _t('Cannot return change without a cash payment method'),
                        comment: _t('There is no cash payment method available in this point of sale to handle the change.\n\n Please pay the exact amount or add a cash payment method in the point of sale configuration')
                    });
                    return;
                }
            }

            if (this.pos.config.iface_cashdrawer) {
                this.pos.proxy.open_cashbox();
            }

            var forEach = Array.prototype.forEach;
            var hasNormalPmt = false;
            var hasPendingPmt = false;
            var hasPospaidPmt = false;
            forEach.call(currentOrder.get('paymentLines').models, function(paymentLine) {
                if (paymentLine.cashregister.journal.x_pending_payment) {
                    hasPendingPmt = true;
                } else if(paymentLine.cashregister.journal.x_post_payment) {
                    hasPospaidPmt = true;
                } else {
                    hasNormalPmt = true;
                }
            });

            if (currentOrder.immutable && !hasPospaidPmt) {
                self.pos_widget.screen_selector.show_popup('error',{
                    'message': _t('Metodo de Pago Invalido'),
                    'comment': _t('Solo se aceptan métodos de pago tipo Pospago para pagar las Ordenes Pendientes.')
                });
                return;
            }

            if (!currentOrder.immutable && hasPospaidPmt) {
                self.pos_widget.screen_selector.show_popup('error',{
                    'message': _t('Metodo de Pago Invalido'),
                    'comment': _t('Los Metodos de Pago tipo Pospago solo pueden pagar Ordenes Pendientes.')
                });
                return;
            }

            if (hasPendingPmt && hasNormalPmt) {
                this.pos_widget.screen_selector.show_popup('error',{
                    'message': _t('Combinación de Pago Inválida'),
                    'comment': _t('El pago pendiente no se puede hacer parcial, la orden debe estar completamente pendiente o completamente paga.')
                });
                return;
            }

            var deliveryDate = new Date();
            var hours = deliveryDate.getHours();
            var minutes = deliveryDate.getMinutes();
            if (currentOrder.x_express_order) {
                // express orders should be delivered same day or not accepted.
                deliveryDate.setHours(hours <= 17 ? hours + 2 : 19, hours <= 17 ? minutes :  0);
            } else {
                deliveryDate.setHours(17, 0);
                if (deliveryDate.getDay() >= 5) {
                    deliveryDate.setDate(deliveryDate.getDate() + 3);
                } else {
                    deliveryDate.setDate(deliveryDate.getDate() + 2);
                }
            }
            currentOrder['x_delivery_date'] = this.formatDate(deliveryDate) + ' ' + this.formatAMPM(deliveryDate);
            currentOrder['x_display_delivery_date'] = 'Para entrega ' + this.formatDisplayDate(deliveryDate) + ' a ' +
            (hours != 1 && hours != 13 ? 'las ' : 'la ') + this.formatAMPM(deliveryDate);

            currentOrder['x_ncf'] = '';
            if ((hasNormalPmt || hasPospaidPmt) && options.tcf) {
                // Get next NCF and set it to the current order.
                currentOrder['x_ncf'] = this.pos.get_next_ncf(options.tcf);
                if (options.tcf == '01') {
                    currentOrder['x_receipt_type'] = 'Válida para Crédito Fiscal';
                    if(!currentOrder.get('client').vat) {
                        this.pos_widget.screen_selector.show_popup('error',{
                            'message': _t('Cliente NO tiene configurado Cedula o RNC'),
                            'comment': _t('Debe configurar la Cedula/RNC del cliente antes de emitir factura fiscal.')
                        });
                        // TODO: solicitar Cedula/RNC manualmente.
                        return;
                    }
                } else {
                    currentOrder['x_receipt_type'] = 'Factura de Consumidor Final';
                }
                currentOrder['x_show_ncf'] = true;
            } else {
                currentOrder['x_show_ncf'] = false;
                currentOrder['x_receipt_type'] = 'Recibo de Orden de Servicio';
            }

            if (options.invoice) {
                // deactivate the validation button while we try to send the order
                self.pos_widget.action_bar.set_button_disabled('validation', true);
                self.pos_widget.action_bar.set_button_disabled('cf.validation', true);
                self.pos_widget.action_bar.set_button_disabled('invoice', true);

                var invoiced = self.pos.push_and_invoice_order(currentOrder);
                invoiced.fail(function (error) {
                    if (error === 'error-no-client') {
                        self.pos_widget.screen_selector.show_popup('error', {
                            message: _t('An anonymous order cannot be invoiced'),
                            comment: _t('Please select a client for this order. This can be done by clicking the order tab')
                        });
                    } else {
                        self.pos_widget.screen_selector.show_popup('error', {
                            message: _t('The order could not be sent'),
                            comment: _t('Check your internet connection and try again.')
                        });
                    }
                    self.pos_widget.action_bar.set_button_disabled('validation', false);
                    self.pos_widget.action_bar.set_button_disabled('invoice', false);
                });
                invoiced.done(function () {
                    self.pos_widget.action_bar.set_button_disabled('validation', false);
                    self.pos_widget.action_bar.set_button_disabled('invoice', false);
                    self.pos.get('selectedOrder').destroy();
                });
            } else {
                self.pos.push_order(currentOrder);
                if (self.pos.config.iface_print_via_proxy) {
                    var receipt = currentOrder.export_for_printing();
                    //console.log(QWeb.render('XmlReceipt', {
                    //    receipt: receipt,
                    //    widget: self
                    //}));
                    // TODO: validate XML Receipt Layout in javascript console to save paper
                    // TODO: buy 2 paper rolls at Cecomsa (80mm and 58mm)
                    // TODO: test both paper sizes
                    self.pos.proxy.print_receipt(QWeb.render('XmlReceipt', {
                        receipt: receipt,
                        widget: self
                    }));
                    self.pos.get('selectedOrder').destroy();    //finish order and go back to scan screen
                } else {
                    self.pos_widget.screen_selector.set_current_screen(self.next_screen);
                }
            }
            if (options.tcf) {
                self.pos.push_ncf_sequence(options.tcf);
            }
            // Removes pending order from UI list.
            if (currentOrder.x_pending_order_id) {
                var index = this.pos.db.pending_order_sorted.indexOf(currentOrder.x_pending_order_id);
                this.pos.db.pending_order_sorted.splice(index, 1);
                delete this.pos.db.pending_order_by_id[currentOrder.x_pending_order_id];
            }
            // hide onscreen (iOS) keyboard
            setTimeout(function () {
                document.activeElement.blur();
                $("input").blur();
            }, 250);
        }
    });

    module.ReceiptScreenWidget = module.ReceiptScreenWidget.extend({
        refresh: function() {
            var order = this.pos.get('selectedOrder');
            var product_quantity = 0;
            var i = 0;
            while (i < order.get('orderLines').models.length) {
                product_quantity += order.get('orderLines').models[i].quantity;
                i++;
            }
            $('.pos-receipt-container', this.$el).html(QWeb.render('PosTicket',{
                widget:this,
                order: order,
                orderlines: order.get('orderLines').models,
                paymentlines: order.get('paymentLines').models,
                prod_qty: product_quantity
            }));
        },
        print: function () {
            var self = this;

            // Delay the print dialog so the Loading label doesn't show up in the printed bill.
            setTimeout(function() {
                self.pos.get('selectedOrder')._printed = true;
                window.print();
            }, 1000);
        }
    });

    module.ClientListScreenWidget = module.ClientListScreenWidget.extend({
        show: function(){
            var self = this;
            this._super();

            this.$('.next').unbind('click');
            this.$('.next').click(function(){
                if (self.pos.get('selectedOrder').immutable && self.has_client_changed()) {
                    // Error: changed client on immutable order.
                    self.pos_widget.screen_selector.show_popup('error',{
                        'message':_t('Error: No se puede cambiar el cliente'),
                        'comment':_t('La orden es una orden pendiente!')
                    });
                    return;
                }
                self.save_changes();
                self.pos_widget.screen_selector.back();
            });
        }
    });

}