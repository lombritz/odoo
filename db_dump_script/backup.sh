db_name=estilo_figura
pg_dump -v -C --dbname=$db_name --host=localhost --port=5432 --username=odoo --file=`date +\%Y\%m\%d\%M\%S`_$db_name.sql
