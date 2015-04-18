from datetime import datetime
from dateutil.relativedelta import relativedelta

dam = datetime.today() - relativedelta(months=1)
print 'Today: ', datetime.today().strftime('%Y%m')
print 'Day after: ', dam.strftime('%Y%m')
