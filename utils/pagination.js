function parsePagination(query) {
  const page = Math.max(parseInt(query.page || '1', 10), 1);
  const limit = Math.min(Math.max(parseInt(query.limit || '20', 10), 1), 100);
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

function toPagination(total, page, limit) {
  return {
    total,
    page,
    limit,
    totalPages: Math.max(Math.ceil(total / limit), 1)
  };
}

module.exports = {
  parsePagination,
  toPagination
};
