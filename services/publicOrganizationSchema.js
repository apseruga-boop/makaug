'use strict';

const { tenantFor } = require('../packages/shared-country-core/config/tenants');

const ACTIVE_TENANT = tenantFor(process.env.COUNTRY_CODE || 'UG');

function publicOrganizationNode() {
  const config = ACTIVE_TENANT.schemaOrg;
  if (!config) return null;
  const home = ACTIVE_TENANT.domain.replace(/\/+$/, '');
  return {
    '@type': [...config.types],
    '@id': `${home}/#organization`,
    name: config.name,
    alternateName: [...config.alternateName],
    url: home,
    logo: new URL(config.logoPath, home).href,
    telephone: ACTIVE_TENANT.phoneE164,
    areaServed: [...config.areaServed],
    parentOrganization: { '@type': 'Organization', name: config.parentOrganization },
    sameAs: [...config.sameAs],
    contactPoint: {
      '@type': 'ContactPoint',
      telephone: ACTIVE_TENANT.phoneE164,
      contactType: config.contactPoint.contactType,
      areaServed: config.contactPoint.areaServed,
      availableLanguage: [...config.contactPoint.availableLanguage]
    }
  };
}

function mergePublicOrganizationSchema(structuredData) {
  const organization = publicOrganizationNode();
  if (!organization) return structuredData;
  const nodes = structuredData?.['@graph'] || (structuredData ? [structuredData] : []);
  return {
    '@context': structuredData?.['@context'] || 'https://schema.org',
    '@graph': [organization, ...nodes.filter((node) => node['@id'] !== organization['@id'])]
  };
}

module.exports = { publicOrganizationNode, mergePublicOrganizationSchema };
