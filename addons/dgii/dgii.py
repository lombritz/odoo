from openerp.osv import fields, osv, orm
import time as the_time
import logging
import base64

_logging = logging.getLogger(__name__)

class dgii_report(osv.osv):
    _name = 'dgii.report'
    _description = 'Modulo de Generacion de Reportes DGII'
    _columns = {
        'name': fields.char('Nombre del reporte', size=50, readonly=True),
        'data': fields.binary('Documento', readonly=True),
        'state': fields.selection([('draft', 'Borrador'), ('confirmed', 'Confirmado')], 'Estado')
    }
    _defaults = {
        'name': lambda *a: 'DGII_F_606_' + the_time.strftime("%Y%m"),
        'state': 'draft'
    }

    def generate_606(self, cr, uid, ids, context=None):
        file_content = "606"
        period = "201503"
        body = ""
        cr.execute('''select '--->RNC_SUP<---' as x_rnc, p.name as pname, ai.* from account_invoice  ai, res_partner p
                       where ai.partner_id = p.id and ai.type = 'in_invoice' order by ai.id;
        ''')

        rows = cr.dictfetchall()
        po_count = cr.rowcount
        a_total  = sum(a['amount_total'] for a in rows)
        ex_total = 0
        another_rnc = '                   ' # 19 espacios
        another_tax = 0
        another_a_untaexed = 0

        for r in rows:
      	    body += r['x_rnc']
      	    if r['supplier_invoice_number'] != None:
               body += "%s" % (r['supplier_invoice_number'])
	    else:
               body += "%s" % (r['name'].zfill(19))

            body += another_rnc
            body += "%s%s" % (period,'04')
            body += "%s%s" % (period,'04') # la otra columna de fecha de pago
            body += '%012.2f' % r['amount_tax']
            body += '%012.2f' % another_tax
            body += '%012.2f' % r['amount_untaxed']
            body += '%012.2f' % another_a_untaexed
            body += '\n'

        cr.execute("select '--->RNC_COM<---' as x_rnc, name from res_company") # agregar x_rnc
        company_info  = cr.dictfetchone()
        file_content += company_info['x_rnc']
        file_content += period
        file_content += '%012d' % po_count
        file_content += '%012.2f' % a_total
        file_content += '%012.2f' % ex_total
        file_content += '\n'
        file_content += body

        file_encoded = base64.encodestring(file_content)
        self.write(cr, uid, ids, {'data': file_encoded}, context=None)
        _logging.info('Wilton Beltre')

        return True
