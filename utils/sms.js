/**
 * Send OTP via SMS or WhatsApp.
 * Configure env:
 *   OTP_MODE=demo|twilio_sms|twilio_whatsapp
 *   TWILIO_ACCOUNT_SID=
 *   TWILIO_AUTH_TOKEN=
 *   TWILIO_FROM_NUMBER=   (SMS)
 *   TWILIO_WHATSAPP_FROM= (whatsapp:+1415...)
 * Demo mode: does not send; returns code so UI can show for testing.
 */

async function sendOtp(phone, code) {
  const mode = (process.env.OTP_MODE || 'demo').toLowerCase();
  const text = `کد تایید صرافی شما: ${code}\nYour exchange verification code: ${code}`;

  if (mode === 'demo' || mode === 'test') {
    console.log(`[OTP DEMO] to ${phone}: ${code}`);
    return { ok: true, mode: 'demo', debugCode: code };
  }

  if (mode === 'twilio_sms' || mode === 'twilio_whatsapp') {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    if (!sid || !token) {
      console.error('Twilio credentials missing');
      return { ok: false, error: 'SMS provider not configured' };
    }
    const to = mode === 'twilio_whatsapp'
      ? (phone.startsWith('whatsapp:') ? phone : `whatsapp:${phone}`)
      : phone;
    const from = mode === 'twilio_whatsapp'
      ? (process.env.TWILIO_WHATSAPP_FROM || process.env.TWILIO_FROM_NUMBER)
      : process.env.TWILIO_FROM_NUMBER;
    if (!from) return { ok: false, error: 'FROM number missing' };

    const auth = Buffer.from(`${sid}:${token}`).toString('base64');
    const body = new URLSearchParams({ To: to, From: from, Body: text });
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body
    });
    if (!res.ok) {
      const err = await res.text();
      console.error('Twilio error', err);
      return { ok: false, error: 'Failed to send SMS' };
    }
    return { ok: true, mode };
  }

  return { ok: false, error: 'Unknown OTP_MODE' };
}

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

module.exports = { sendOtp, generateOtp };
