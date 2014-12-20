function openerp_pos_ncf_models(instance, module){ //module is instance.point_of_sale
    var QWeb = instance.web.qweb,
        _t = instance.web._t;

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

        // Server side model loaders. This is the list of the models that need to be loaded from
        // the server. The models are loaded one by one by this list's order. The 'loaded' callback
        // is used to store the data in the appropriate place once it has been loaded. This callback
        // can return a deferred that will pause the loading of the next module.
        // a shared temporary dictionary is available for loaders to communicate private variables
        // used during loading such as object ids, etc.
        models: [
            {
                model:  'res.users',
                fields: ['name','company_id'],
                ids:    function(self){ return [self.session.uid]; },
                loaded: function(self,users){ self.user = users[0]; },
            },{
                model:  'res.company',
                fields: [ 'currency_id', 'email', 'website', 'company_registry', 'vat', 'name', 'phone', 'partner_id' , 'country_id'],
                ids:    function(self){ return [self.user.company_id[0]] },
                loaded: function(self,companies){ self.company = companies[0]; },
            },{
                model:  'decimal.precision',
                fields: ['name','digits'],
                loaded: function(self,dps){
                    self.dp  = {};
                    for (var i = 0; i < dps.length; i++) {
                        self.dp[dps[i].name] = dps[i].digits;
                    }
                },
            },{
                model:  'product.uom',
                fields: [],
                domain: null,
                loaded: function(self,units){
                    self.units = units;
                    var units_by_id = {};
                    for(var i = 0, len = units.length; i < len; i++){
                        units_by_id[units[i].id] = units[i];
                        units[i].groupable = ( units[i].category_id[0] === 1 );
                        units[i].is_unit   = ( units[i].id === 1 );
                    }
                    self.units_by_id = units_by_id;
                }
            },{
                model:  'res.users',
                fields: ['name','ean13'],
                domain: null,
                loaded: function(self,users){ self.users = users; },
            },{
                model:  'res.partner',
                fields: ['name','street','city','state_id','country_id','vat','phone','zip','mobile','email','ean13','write_date'],
                domain: null,
                loaded: function(self,partners){
                    self.partners = partners;
                    self.db.add_partners(partners);
                },
            },{
                model:  'res.country',
                fields: ['name'],
                loaded: function(self,countries){
                    self.countries = countries;
                    self.company.country = null;
                    for (var i = 0; i < countries.length; i++) {
                        if (countries[i].id === self.company.country_id[0]){
                            self.company.country = countries[i];
                        }
                    }
                },
            },{
                model:  'account.tax',
                fields: ['name','amount', 'price_include', 'type'],
                domain: null,
                loaded: function(self,taxes){ self.taxes = taxes; },
            },{
                model:  'pos.session',
                fields: ['id', 'journal_ids','name','user_id','config_id','start_at','stop_at','sequence_number','login_number'],
                domain: function(self){ return [['state','=','opened'],['user_id','=',self.session.uid]]; },
                loaded: function(self,pos_sessions){
                    self.pos_session = pos_sessions[0];
                    var orders = self.db.get_orders();
                    for (var i = 0; i < orders.length; i++) {
                        self.pos_session.sequence_number = Math.max(self.pos_session.sequence_number, orders[i].data.sequence_number+1);
                    }
                },
            },{
                model: 'pos.config',
                fields: [],
                domain: function(self){ return [['id','=', self.pos_session.config_id[0]]]; },
                loaded: function(self,configs){
                    self.config = configs[0];
                    self.config.use_proxy = self.config.iface_payment_terminal ||
                    self.config.iface_electronic_scale ||
                    self.config.iface_print_via_proxy  ||
                    self.config.iface_scan_via_proxy   ||
                    self.config.iface_cashdrawer;

                    self.barcode_reader.add_barcode_patterns({
                        'product':  self.config.barcode_product,
                        'cashier':  self.config.barcode_cashier,
                        'client':   self.config.barcode_customer,
                        'weight':   self.config.barcode_weight,
                        'discount': self.config.barcode_discount,
                        'price':    self.config.barcode_price,
                    });

                    if (self.config.company_id[0] !== self.user.company_id[0]) {
                        throw new Error(_t("Error: The Point of Sale User must belong to the same company as the Point of Sale. You are probably trying to load the point of sale as an administrator in a multi-company setup, with the administrator account set to the wrong company."));
                    }
                },
            },{
                model: 'stock.location',
                fields: [],
                ids:    function(self){ return [self.config.stock_location_id[0]]; },
                loaded: function(self, locations){ self.shop = locations[0]; },
            },{
                model:  'product.pricelist',
                fields: ['currency_id'],
                ids:    function(self){ return [self.config.pricelist_id[0]]; },
                loaded: function(self, pricelists){ self.pricelist = pricelists[0]; },
            },{
                model: 'res.currency',
                fields: ['symbol','position','rounding','accuracy'],
                ids:    function(self){ return [self.pricelist.currency_id[0]]; },
                loaded: function(self, currencies){
                    self.currency = currencies[0];
                    if (self.currency.rounding > 0) {
                        self.currency.decimals = Math.ceil(Math.log(1.0 / self.currency.rounding) / Math.log(10));
                    } else {
                        self.currency.decimals = 0;
                    }

                },
            },{
                model: 'product.packaging',
                fields: ['ean','product_tmpl_id'],
                domain: null,
                loaded: function(self, packagings){
                    self.db.add_packagings(packagings);
                },
            },{
                model:  'pos.category',
                fields: ['id','name','parent_id','child_id','image'],
                domain: null,
                loaded: function(self, categories){
                    self.db.add_categories(categories);
                },
            },{
                model:  'product.product',
                fields: ['display_name', 'list_price','price','pos_categ_id', 'taxes_id', 'ean13', 'default_code',
                    'to_weight', 'uom_id', 'uos_id', 'uos_coeff', 'mes_type', 'description_sale', 'description',
                    'product_tmpl_id'],
                domain:  function(self){ return [['sale_ok','=',true],['available_in_pos','=',true]]; },
                context: function(self){ return { pricelist: self.pricelist.id, display_default_code: false }; },
                loaded: function(self, products){
                    self.db.add_products(products);
                },
            },{
                model:  'account.bank.statement',
                fields: ['account_id','currency','journal_id','state','name','user_id','pos_session_id'],
                domain: function(self){ return [['state', '=', 'open'],['pos_session_id', '=', self.pos_session.id]]; },
                loaded: function(self, bankstatements, tmp){
                    self.bankstatements = bankstatements;

                    tmp.journals = [];
                    _.each(bankstatements,function(statement){
                        tmp.journals.push(statement.journal_id[0]);
                    });
                },
            },{
                model:  'account.journal',
                fields: [],
                domain: function(self,tmp){ return [['id','in',tmp.journals]]; },
                loaded: function(self, journals){
                    self.journals = journals;

                    // associate the bank statements with their journals.
                    var bankstatements = self.bankstatements;
                    for(var i = 0, ilen = bankstatements.length; i < ilen; i++){
                        for(var j = 0, jlen = journals.length; j < jlen; j++){
                            if(bankstatements[i].journal_id[0] === journals[j].id){
                                bankstatements[i].journal = journals[j];
                            }
                        }
                    }
                    self.cashregisters = bankstatements;
                },
            },{
                label: 'fonts',
                loaded: function(self){
                    var fonts_loaded = new $.Deferred();

                    // Waiting for fonts to be loaded to prevent receipt printing
                    // from printing empty receipt while loading Inconsolata
                    // ( The font used for the receipt )
                    waitForWebfonts(['Lato','Inconsolata'], function(){
                        fonts_loaded.resolve();
                    });

                    // The JS used to detect font loading is not 100% robust, so
                    // do not wait more than 5sec
                    setTimeout(function(){
                        fonts_loaded.resolve();
                    },5000);

                    return fonts_loaded;
                },
            },{
                label: 'pictures',
                loaded: function(self){
                    self.company_logo = new Image();
                    var  logo_loaded = new $.Deferred();
                    self.company_logo.onload = function(){
                        var img = self.company_logo;
                        var ratio = 1;
                        var targetwidth = 300;
                        var maxheight = 150;
                        if( img.width !== targetwidth ){
                            ratio = targetwidth / img.width;
                        }
                        if( img.height * ratio > maxheight ){
                            ratio = maxheight / img.height;
                        }
                        var width  = Math.floor(img.width * ratio);
                        var height = Math.floor(img.height * ratio);
                        var c = document.createElement('canvas');
                        c.width  = width;
                        c.height = height
                        var ctx = c.getContext('2d');
                        ctx.drawImage(self.company_logo,0,0, width, height);

                        self.company_logo_base64 = c.toDataURL();
                        logo_loaded.resolve();
                    };
                    self.company_logo.onerror = function(){
                        logo_loaded.reject();
                    };
                    self.company_logo.crossOrigin = "anonymous";
                    self.company_logo.src = '/web/binary/company_logo' +'?_'+Math.random();

                    return logo_loaded;
                },
            },{
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
            },{
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

                        new instance.web.Model('pos.order.line')
                            .query([])
                            .filter([['order_id','=',order.id]])
                            .all()
                            .then(function(orderlines) {
                                // add orderlines
                                _.each(orderlines, function(orderline) {
                                    var product = self.db.get_product_by_id(orderline.product_id[0]);
                                    order.addProduct(product, {price:product.price});
                                });
                            });
                        self.db.add_pending_orders([order]);
                    });
                }
            }
        ],

        get_next_ncf: function(ncf_type) {
            var sequence = this.ncf_sequences[ncf_type];
            var next = this.ncf_sequences_next[ncf_type];

            if(!sequence) {
                console.error('No sequence found for:'+ncf_type);
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
                                    order.addProduct(product, {price:product.price});
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
                x_ncf: this.x_ncf
            };
        }
    });
}