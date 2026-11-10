const httpError = (status, message) => Object.assign(new Error(message), { status })
module.exports = { httpError }
