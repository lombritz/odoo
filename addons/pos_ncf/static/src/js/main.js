openerp.pos_ncf = function(instance){

    var module = instance.point_of_sale;

    openerp_pos_ncf_db(instance, module);

    openerp_pos_ncf_models(instance, module);

    openerp_pos_ncf_screens(instance, module);

    openerp_pos_ncf_widgets(instance, module);

};
