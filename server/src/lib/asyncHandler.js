/** Kap gabimet nga route async — Express 4 nuk i kap automatikisht */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = { asyncHandler };
