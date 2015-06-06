function openerp_pos_ncf_models(instance, module){ //module is instance.point_of_sale
    var QWeb = instance.web.qweb,
        _t = instance.web._t;

    var round_di = instance.web.round_decimals;
    var round_pr = instance.web.round_precision;

    module.PosModel = module.PosModel.extend({
        show: function() {
            var self = this;
            this._super();

            this.reload_pending_orders();
        },

        // This fetches pending order changes on the server, and in case of changes,
        // rerenders the affected views
        reload_pending_orders: function(){
            var self = this;
            return this.pos.load_pending_orders().then(function(){
                self.render_list(self.pos.db.get_pending_orders_sorted(1000));

                // update the currently assigned client if it has been changed in db.
                var curr_client = self.pos.get_order().get_client();
                if (curr_client) {
                    self.pos.get_order().set_client(self.pos.db.get_partner_by_id(curr_client.id));
                }
            });
        },


        initialize: function(session, attributes) {
            Backbone.Model.prototype.initialize.call(this, attributes);
            var  self = this;
            this.session = session;
            this.flush_mutex = new $.Mutex();                   // used to make sure the orders are sent to the server once at time
            this.pos_widget = attributes.pos_widget;

            this.proxy = new module.ProxyDevice(this);              // used to communicate to the hardware devices via a local proxy
            this.barcode_reader = new module.BarcodeReader({'pos': this, proxy:this.proxy, patterns: {}});  // used to read barcodes
            this.proxy_queue = new module.JobQueue();           // used to prevent parallels communications to the proxy
            this.db = new module.PosDB();                       // a local database used to search trough products and categories & store pending orders
            this.debug = jQuery.deparam(jQuery.param.querystring()).debug !== undefined;    //debug mode

            // Business data; loaded from the server at launch
            this.accounting_precision = 2; //TODO
            this.company_logo = null;
            this.company_logo_base64 = '';
            this.currency = null;
            this.shop = null;
            this.company = null;
            this.user = null;
            this.users = [];
            this.partners = [];
            this.cashier = null;
            this.cashregisters = [];
            this.bankstatements = [];
            this.taxes = [];
            this.pos_session = null;
            this.config = null;
            this.units = [];
            this.units_by_id = {};
            this.pricelist = null;
            this.order_sequence = 1;
            window.posmodel = this;
            this.ncf_sequences = {};
            this.ncf_sequences_next = {};


            // these dynamic attributes can be watched for change by other models or widgets
            this.set({
                'synch':            { state:'connected', pending:0 },
                'orders':           new module.OrderCollection(),
                'selectedOrder':    null
            });

            this.bind('change:synch',function(pos,synch){
                clearTimeout(self.synch_timeout);
                self.synch_timeout = setTimeout(function(){
                    if(synch.state !== 'disconnected' && synch.pending > 0){
                        self.set('synch',{state:'disconnected', pending:synch.pending});
                    }
                },3000);
            });

            this.get('orders').bind('remove', function(order,_unused_,options){
                self.on_removed_order(order,options.index,options.reason);
            });

            this.models.push({
                model: 'ir.sequence',
                fields: [],
                domain: function(self) { return [['x_pos_config_id', '=', self.config.id]]; },
                loaded: function(self, sequences) {
                    $.each(sequences, function(i) {
                        var sequence = sequences[i];
                        self.ncf_sequences[sequence['x_tcf']] = sequence;
                        self.ncf_sequences_next[sequence['x_tcf']] = sequence['number_next_actual'];
                    });
                }
            });

            this.models.push({
                model: 'pos.order',
                fields: [],
                domain: function(self) { return [['state', '=', 'pending'], ['company_id', '=', self.company.id]]; },
                loaded: function(self, orders) {
                    _.each(orders, function(_order) {
                        var order = new module.Order({pos:self});
                        order.set('order', _order);
                        order.set('id', _order.id);
                        var partner = self.db.get_partner_by_id(_order.partner_id[0]);
                        order.set_client(partner);
                        order.set('x_ncf', _order.x_ncf);
                        order.set('creationDate', _order.date_order);
                        order.set('companyName', _order.company_id[1]);
                        order.set('x_express_order', _order.x_express_order);

                        new instance.web.Model('pos.order.line')
                            .query([])
                            .filter([['order_id','=',order.id]])
                            .all()
                            .then(function(orderlines) {
                                // add orderlines
                                _.each(orderlines, function(orderline) {
                                    var product = self.db.get_product_by_id(orderline.product_id[0]);
                                    if (product) {
                                        order.addProduct(product, {
                                            price: product.price,
                                            quantity: orderline.qty,
                                            discount: orderline.discount
                                        });
                                    }
                                });
                            });
                        self.db.add_pending_orders([order]);
                    });
                }
            });

            this.models.push({
                model: 'product.template',
                fields: ['id', 'list_price', 'x_express_price'],
                domain: function(self) { return [['sale_ok', '=', true] , ['available_in_pos', '=', true]] },
                loaded: function(self, product_templates) {
                    _.each(product_templates, function(_product_template) {
                        self.db.add_product_template(_product_template);
                    });
                }
            });

            // We fetch the backend data on the server asynchronously. this is done only when the pos user interface is launched,
            // Any change on this data made on the server is thus not reflected on the point of sale until it is relaunched.
            // when all the data has loaded, we compute some stuff, and declare the Pos ready to be used.
            this.ready = this.load_server_data()
                .then(function(){
                    if(self.config.use_proxy){
                        return self.connect_to_proxy();
                    }
                });

        },

        get_next_ncf: function(ncf_type) {
            var sequence = this.ncf_sequences[ncf_type];
            var next = this.ncf_sequences_next[ncf_type];

            if(!sequence) {
                //console.error('No sequence found for:'+ncf_type);
                return 'Error';
            }

            // Calculate NCF variables.
            var serial = 'A';
            var dn = sequence['x_dn'];
            var pe = sequence['x_pe'];
            var ai = sequence['x_ai'];
            var tcf = sequence['x_tcf'];
            var sequential = ("00000000" + next).slice(-8);

            // Assembling NCF.
            var ncf = serial + dn + pe + ai + tcf + sequential;

            // Increment sequential.
            this.ncf_sequences_next[ncf_type] = next + 1;

            return ncf;
        },

        _flush_ncf_sequence: function(tcf) {
            var self = this;
            var irSeqModel = new openerp.Model('ir.sequence');

            var seq_id = this.ncf_sequences[tcf]['id'];
            var new_next = this.ncf_sequences_next[tcf];

            // Execute update.
            return irSeqModel.call('write', [seq_id, { 'number_next_actual': new_next}])
                .fail(function(error, event) {
                    if(error.code === 200) {
                        self.pos_widget.screen_selector.show_popup('error-traceback',{
                            message: error.data.message,
                            comment: error.data.debug
                        });
                    }
                    // prevent an error popup creation by the rpc failure
                    // we want the failure to be silent as we send the orders in the background
                    event.preventDefault();
                });
        },

        push_ncf_sequence: function(tcf) {
            var self = this;
            var pushed = new $.Deferred();

            this.flush_mutex.exec(function() {
                var flushed = self._flush_ncf_sequence(tcf);
                flushed.always(function(resp) {
                    pushed.resolve();
                });
            });
            return pushed;
        },

        // reload the list of partner, returns as a deferred that resolves if there were
        // updated partners, and fails if not
        load_new_partners: function(){
            var self = this;
            var def  = new $.Deferred();
            var fields = _.find(this.models,function(model){ return model.model === 'res.partner'; }).fields;
            new instance.web.Model('res.partner')
                .query(fields)
                .filter([['write_date','>',this.db.get_partner_write_date()]])
                .all({'timeout':3000, 'shadow': true})
                .then(function(partners){
                    if (self.db.add_partners(partners)) {   // check if the partners we got were real updates
                        def.resolve();
                    }
                }, function(error, event){
                    // prevent an error popup creation by the rpc failure
                    // we want the failure to be silent as we send the orders in the background
                    event.preventDefault();
                });
            return def;
        },

        load_pending_orders: function() {
            var self = this;
            var def  = new $.Deferred();
            var fields = [];
            new instance.web.Model('pos.order')
                .query(fields)
                .filter([['state', '=', 'pending'], ['company_id', '=', self.company.id]])
                .all()
                .then(function(orders){
                    _.each(orders, function(_order) {
                        var order = new module.Order({pos:self});
                        order.set('order', _order);
                        order.set('id', _order.id);
                        var partner = self.db.get_partner_by_id(_order.partner_id[0]);
                        order.set_client(partner);
                        order.set('x_ncf', _order.x_ncf);
                        order.set('creationDate', _order.date_order);
                        order.set('companyName', _order.company_id[1]);

                        new instance.web.Model('pos.order.line')
                            .query([])
                            .filter([['order_id','=',order.id]])
                            .all()
                            .then(function(orderlines) {
                                // add orderlines
                                _.each(orderlines, function(orderline) {
                                    var product = self.db.get_product_by_id(orderline.product_id[0]);
                                    if (product) {
                                        order.addProduct(product, {
                                            price: product.price,
                                            quantity: orderline.qty,
                                            discount: orderline.discount
                                        });
                                    }
                                });
                            });
                        self.db.add_pending_orders([order]);
                    });
                }, function(error, event){
                    // prevent an error popup creation by the rpc failure
                    // we want the failure to be silent as we send the orders in the background
                    event.preventDefault();
                });
            return def;
        }

    });

    module.Order = module.Order.extend({
        immutable: false,

        x_pending_order_id: 0,

        x_express_order: false,

        set_immutable: function(immutable) {
            this.immutable = immutable;
        },

        set_pending_order_id: function(x_pending_order_id) {
            this.x_pending_order_id = x_pending_order_id;
        },

        // HERE THE PAYMENT AMOUNT IS SET WHEN PAYMENT IS NOT CASH.
        addPaymentline: function(cashregister) {
            var paymentLines = this.get('paymentLines');
            var newPaymentline = new module.Paymentline({},{cashregister:cashregister, pos:this.pos});
            if(cashregister.journal.type !== 'cash'){
                newPaymentline.set_amount( Math.max(this.getDueLeft(),0) );
            }
            paymentLines.add(newPaymentline);
            this.selectPaymentline(newPaymentline);

        },

        // get total + express with taxes.
        getTotalTaxIncluded: function() {
            var self = this;
            return (this.get('orderLines')).reduce((function(sum, orderLine) {
                return sum + orderLine.get_price_with_tax() +
                     (self.x_express_order ? orderLine.get_express_price() * orderLine.get_quantity() : 0);
            }), 0);
        },

        getDueLeft: function() {
            return this.getTotalTaxIncluded() - this.getPaidTotal();
        },

        getTotalExpress: function() {
            if ( this.x_express_order ) {
                return (this.get('orderLines')).reduce((function(sum, orderLine){
                    return sum + (orderLine.get_express_price() * orderLine.get_quantity());
                }), 0);
            } else {
                return 0;
            }
        },

        addProduct: function(product, options) {
            if (this.immutable) {
                this.pos.pos_widget.screen_selector.show_popup('error',{
                    message: _t("No puede agregar productos"),
                    comment: _t('No puede agregar productos a una orden pendiente')
                });
            } else {
                options = options || {};
                var attr = JSON.parse(JSON.stringify(product));
                attr.pos = this.pos;
                attr.order = this;
                var line = new module.Orderline({}, {pos: this.pos, order: this, product: product});
                var product_template = this.pos.db.get_product_template_by_id(product.product_tmpl_id);
                if (product_template) {
                    line.set_express_price(product_template['x_express_price']);
                }
                if(options.quantity !== undefined){
                    line.set_quantity(options.quantity);
                }
                if(options.price !== undefined){
                    line.set_unit_price(options.price);
                }
                if(options.discount !== undefined){
                    line.set_discount(options.discount);
                }

                var last_orderline = this.getLastOrderline();
                if( last_orderline && last_orderline.can_be_merged_with(line) && options.merge !== false){
                    last_orderline.merge(line);
                }else{
                    this.get('orderLines').add(line);
                }
                this.selectLine(this.getLastOrderline());
            }
        },
        // exports a JSON for receipt printing

        // TODO: add new data: NCF, client info, etc... and refactor XML receipt leyout.
        export_for_printing: function(){
            var orderlines = [];
            this.get('orderLines').each(function(orderline){
                orderlines.push(orderline.export_for_printing());
            });

            var paymentlines = [];
            this.get('paymentLines').each(function(paymentline){
                paymentlines.push(paymentline.export_for_printing());
            });
            var client  = this.get('client');
            var cashier = this.pos.cashier || this.pos.user;
            var company = this.pos.company;
            var shop    = this.pos.shop;
            var date = new Date();

            return {
                orderlines: orderlines,
                paymentlines: paymentlines,
                subtotal: this.getSubtotal(),
                total_with_tax: this.getTotalTaxIncluded(),
                total_without_tax: this.getTotalTaxExcluded(),
                total_tax: this.getTax(),
                total_paid: this.getPaidTotal(),
                total_discount: this.getDiscountTotal(),
                tax_details: this.getTaxDetails(),
                change: this.getChange(),
                name : this.getName(),
                client: client ? client : null,
                x_ncf: this.x_ncf,
                x_delivery_date: this.x_delivery_date,
                x_pending_order_id: this.x_pending_order_id,
                x_express_order: this.x_express_order,
                invoice_id: null,   //TODO
                cashier: cashier ? cashier.name : null,
                header: this.pos.config.receipt_header || '',
                footer: this.pos.config.receipt_footer || '',
                precision: {
                    price: 2,
                    money: 2,
                    quantity: 3,
                },
                date: {
                    year: date.getFullYear(),
                    month: date.getMonth(),
                    date: date.getDate(),       // day of the month
                    day: date.getDay(),         // day of the week
                    hour: date.getHours(),
                    minute: date.getMinutes() ,
                    isostring: date.toISOString(),
                    localestring: date.toLocaleString(),
                },
                company:{
                    email: company.email,
                    website: company.website,
                    company_registry: company.company_registry,
                    contact_address: company.partner_id[1],
                    vat: company.vat,
                    name: company.name,
                    phone: company.phone,
                    logo:  this.pos.company_logo_base64,
                },
                shop:{
                    name: shop.name,
                },
                currency: this.pos.currency,
            };
        },

        export_as_JSON: function() {
            var orderLines, paymentLines;
            orderLines = [];
            (this.get('orderLines')).each(_.bind( function(item) {
                return orderLines.push([0, 0, item.export_as_JSON()]);
            }, this));
            paymentLines = [];
            (this.get('paymentLines')).each(_.bind( function(item) {
                return paymentLines.push([0, 0, item.export_as_JSON()]);
            }, this));
            return {
                name: this.getName(),
                amount_paid: this.getPaidTotal(),
                amount_total: this.getTotalTaxIncluded(),
                amount_tax: this.getTax(),
                amount_return: this.getChange(),
                lines: orderLines,
                statement_ids: paymentLines,
                pos_session_id: this.pos.pos_session.id,
                partner_id: this.get_client() ? this.get_client().id : false,
                user_id: this.pos.cashier ? this.pos.cashier.id : this.pos.user.id,
                uid: this.uid,
                sequence_number: this.sequence_number,
                x_ncf: this.x_ncf,
                x_delivery_date: this.x_delivery_date,
                x_pending_order_id: this.x_pending_order_id,
                x_express_order: this.x_express_order
            };
        }
    });

    module.Orderline = module.Orderline.extend({
        express_price: 0,
        set_express_price: function(express_price){
            this.express_price = express_price;
        },
        get_express_price: function(){
            return this.express_price;
        },
        set_discount: function(discount){
            if (this.order.immutable) {
                this.pos.pos_widget.screen_selector.show_popup('error',{
                    message: _t("No puede agregar descuento"),
                    comment: _t('No puede agregar descuento a una orden pendiente')
                });
            } else {
                var disc = Math.min(Math.max(parseFloat(discount) || 0, 0), 100);
                this.discount = disc;
                this.discountStr = '' + disc;
                this.trigger('change', this);
            }
        },
        set_quantity: function(quantity){
            if (this.order.immutable) {
                this.pos.pos_widget.screen_selector.show_popup('error',{
                    message: _t("No puede cambiar cantidad de producto"),
                    comment: _t('No puede cambiar cantidad de producto en una orden pendiente')
                });
            } else {
                if (quantity === 'remove') {
                    this.order.removeOrderline(this);
                    return;
                } else {
                    var quant = parseFloat(quantity) || 0;
                    var unit = this.get_unit();
                    if (unit) {
                        if (unit.rounding) {
                            this.quantity = round_pr(quant, unit.rounding);
                            this.quantityStr = this.quantity.toFixed(Math.ceil(Math.log(1.0 / unit.rounding) / Math.log(10)));
                        } else {
                            this.quantity = round_pr(quant, 1);
                            this.quantityStr = this.quantity.toFixed(0);
                        }
                    } else {
                        this.quantity = quant;
                        this.quantityStr = '' + this.quantity;
                    }
                }
                this.trigger('change', this);
            }
        },
        set_unit_price: function(price){
            if (this.order.immutable) {
                this.pos.pos_widget.screen_selector.show_popup('error',{
                    message: _t("No puede cambiar precio de un producto"),
                    comment: _t('No puede cambiar precio de un producto en una orden pendiente')
                });
            } else {
                this.price = round_di(parseFloat(price) || 0, this.pos.dp['Product Price']);
                this.trigger('change', this);
            }
        }
    });

}
