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
  }),
  ZA: Object.freeze({
    countryCode: "ZA",
    countryName: "South Africa",
    brandName: "seshaikhaya",
    publicName: "seshaikhaya.com",
    domain: "https://seshaikhaya.com",
    email: "hello@seshaikhaya.com",
    currencyCode: "ZAR",
    currencyLabel: "R",
    capital: "Pretoria",
    geographySingular: "province",
    geographyPlural: "provinces",
    geographyCount: 9,
    locationHierarchy: Object.freeze(["province", "city", "suburb"]),
    phoneCountryCode: "+27",
    phoneE164: "",
    phoneDisplay: "Number coming soon",
    logoLetter: "S",
    logoSuffix: "",
    localeStorageKey: "seshaikhaya_lang",
    timezone: "Africa/Johannesburg",
    dateLocale: "en-ZA",
    currencies: Object.freeze([
      Object.freeze({ code: "ZAR", label: "R (ZAR)" }),
      Object.freeze({ code: "USD", label: "$ (USD)" }),
      Object.freeze({ code: "EUR", label: "€ (EUR)" }),
      Object.freeze({ code: "GBP", label: "£ (GBP)" })
    ]),
    publicFeatures: Object.freeze({
      sale: true,
      rent: true,
      student: true,
      commercial: true,
      land: true,
      bondFinder: true,
      brokers: true,
      askAi: true,
      whatsapp: true,
      marketplace: false,
      valuation: false
    }),
    lenders: Object.freeze([
      "Standard Bank",
      "ABSA",
      "FNB",
      "Nedbank",
      "Investec",
      "SA Home Loans",
      "ooba"
    ]),
    saslAccessibilityNote: "South African Sign Language accessibility mode retains English text and prioritises captioned, signed video where available.",
    languages: Object.freeze([
      Object.freeze({ code: "en", label: "English" }),
      Object.freeze({ code: "af", label: "Afrikaans" }),
      Object.freeze({ code: "zu", label: "isiZulu" }),
      Object.freeze({ code: "xh", label: "isiXhosa" }),
      Object.freeze({ code: "nso", label: "Sepedi" }),
      Object.freeze({ code: "tn", label: "Setswana" }),
      Object.freeze({ code: "st", label: "Sesotho" }),
      Object.freeze({ code: "ts", label: "X\u0069tsonga" }),
      Object.freeze({ code: "ss", label: "siSwati" }),
      Object.freeze({ code: "ve", label: "Tshivenda" }),
      Object.freeze({ code: "nr", label: "isiNdebele" }),
      Object.freeze({
        code: "sasl",
        label: "SASL (South African Sign Language)",
        accessibilityMode: true,
        textFallback: "en"
      })
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
