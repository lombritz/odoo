function openerp_pos_ncf_widgets(instance, module) { //module is instance.point_of_sale
    var QWeb = instance.web.qweb;
    var _t = instance.web._t;

    module.PosWidget = module.PosWidget.extend({
        // This method instantiates all the screens, widgets, etc. If you want to add new screens change the
        // startup screen, etc, override this method.
        build_widgets: function () {
            var self = this;
            this._super();

            if (false) {// TODO: implement configurable parameter for the POS to allow unpaid orders.
                // --------  New Screens definitions.
                this.orderlist_screen = new module.PendingOrderListScreenWidget(this, {});
                this.orderlist_screen.appendTo(this.$('.screens'));

                // -------- Misc.
                this.pendingorders_button = new module.HeaderButtonWidget(this, {
                    label: _t('Ordenes Pendientes'),
                    action: function () {
                        self.screen_selector.set_current_screen('orderlist', {}, true);
                    }
                });
                this.pendingorders_button.appendTo(this.$('.pos-rightheader'));

                // --------  Adding Pending Order Screen to screen_selector.
                this.screen_selector.add_screen('orderlist', this.orderlist_screen);
            }
        }
    });
}