const SHARED_CORE_PHASE1_MARKER = "shared-core-phase1-20260724";

const TENANTS = Object.freeze({
  UG: Object.freeze({
    countryCode: "UG",
    countryName: "Uganda",
    brandName: "makaug",
    publicName: "makaug.com",
    domain: "https://makaug.com",
    email: "info@makaug.com",
    currencyCode: "UGX",
    currencyLabel: "USh",
    capital: "Kampala",
    geographySingular: "district",
    geographyPlural: "districts",
    geographyCount: 146,
    phoneE164: "+256760112587",
    phoneDisplay: "0760112587",
    logoLetter: "M",
    logoSuffix: ".com",
    localeStorageKey: "makaug_lang",
    languages: Object.freeze([
      Object.freeze({ code: "en", label: "English" }),
      Object.freeze({ code: "lg", label: "Luganda" }),
      Object.freeze({ code: "sw", label: "Kiswahili" }),
      Object.freeze({ code: "ac", label: "Acholi" }),
      Object.freeze({ code: "ny", label: "Runyankole" }),
      Object.freeze({ code: "rn", label: "Rukiga" }),
      Object.freeze({ code: "sm", label: "Lusoga" }),
      Object.freeze({ code: "am", label: "Amharic" }),
      Object.freeze({ code: "ar", label: "Arabic" })
    ])
  }),
  KE: Object.freeze({
    countryCode: "KE",
    countryName: "Kenya",
    brandName: "nyumbake",
    publicName: "nyumbake",
    domain: "https://nyumbake.com",
    email: "hello@nyumbake.com",
    currencyCode: "KES",
    currencyLabel: "KSh",
    capital: "Nairobi",
    geographySingular: "county",
    geographyPlural: "counties",
    geographyCount: 47,
    phoneE164: "",
    phoneDisplay: "",
    logoLetter: "N",
    logoSuffix: "",
    localeStorageKey: "nyumbake_lang",
    languages: Object.freeze([
      Object.freeze({ code: "en", label: "English" }),
      Object.freeze({ code: "sw", label: "Kiswahili" })
    ])
  })
});

function tenantFor(countryCode) {
  const normalized = String(countryCode || "").trim().toUpperCase();
  const tenant = TENANTS[normalized];
  if (!tenant) throw new Error(`Unsupported country tenant: ${normalized || "(empty)"}`);
  return tenant;
}

module.exports = {
  SHARED_CORE_PHASE1_MARKER,
  TENANTS,
  tenantFor
};
