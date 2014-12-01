
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

function openerp_pos_ncf(instance, module){ //module is instance.point_of_sale
    var QWeb = instance.web.qweb,
    _t = instance.web._t;

    module.PaymentScreenWidget = module.PaymentScreenWidget.extend({
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

            if(!this.is_paid()){
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


            var ir_sequence = new openerp.Model('ir.sequence');
            var sequence_code = 'cf.consumidor.final';
            if (currentOrder.get('client')) {
                console.log('Client set!')
            } else {
                console.log('No client!')
            }

            ir_sequence.call('next_by_code', [sequence_code]).then(
                function(ncf) {
                    // Get next NCF and set it to the current order.
                    currentOrder['x_ncf'] = ncf;

                    if (options.invoice) {
                        // deactivate the validation button while we try to send the order
                        self.pos_widget.action_bar.set_button_disabled('validation', true);
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
                        self.pos.push_order(currentOrder)
                        if (self.pos.config.iface_print_via_proxy) {
                            var receipt = currentOrder.export_for_printing();
                            self.pos.proxy.print_receipt(QWeb.render('XmlReceipt', {
                                receipt: receipt,
                                widget: self
                            }));
                            self.pos.get('selectedOrder').destroy();    //finish order and go back to scan screen
                        } else {
                            self.pos_widget.screen_selector.set_current_screen(self.next_screen);
                        }
                    }

                    // hide onscreen (iOS) keyboard
                    setTimeout(function () {
                        document.activeElement.blur();
                        $("input").blur();
                    }, 250);
                }
            );
        }
    });
}