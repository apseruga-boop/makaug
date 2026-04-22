UPDATE users
SET role = 'admin',
    phone_verified = TRUE,
    status = 'active'
WHERE id = 'a16c8c12-7d6d-4d3e-ba13-216aeab326cf'
   OR LOWER(email) = 'admin@makaug.com'
   OR phone = '+256760112587';
