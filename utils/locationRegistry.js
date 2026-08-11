'use strict';

const countryCode = String(process.env.COUNTRY_CODE || 'UG').trim().toUpperCase();

module.exports = countryCode === 'ZA'
  ? require('./southAfricaLocationRegistry')
  : require('./ugandaLocationRegistry');
