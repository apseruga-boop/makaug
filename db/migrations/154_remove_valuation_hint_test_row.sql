-- Remove the single price hint written while checking that migration 153
-- had applied. A second run deletes nothing.

DELETE FROM valuation_price_hints
 WHERE note = 'deploy check 484'
   AND location = 'Abim'
   AND price = 45000000;
