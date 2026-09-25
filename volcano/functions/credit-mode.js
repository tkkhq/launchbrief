const { reply, identity, creditGateEnabled } = require('./_shared/core');

exports.handler = async (event) => {
  const auth = identity(event);
  if (!auth) return reply(401, { error: 'Sign in to view credit mode.' });
  return reply(200, { credits_required: creditGateEnabled(auth.email) });
};
