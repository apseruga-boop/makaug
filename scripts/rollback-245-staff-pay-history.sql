-- Rollback for migration 245: salary history and the add/remove log are lost
-- if you run this. Staff added through the page stay as users; set them to
-- status 'suspended' by hand if they must go too.
BEGIN;
DROP TABLE IF EXISTS staff_salaries;
DROP TABLE IF EXISTS staff_changes;
DELETE FROM schema_migrations WHERE filename = '245_staff_pay_history.sql';
COMMIT;
