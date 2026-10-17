export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    try {
      const body = await request.json();
      console.log('Получен вебхук:', JSON.stringify(body));

      if (body.event === 'payment.succeeded') {
        const payment = body.object;
        const bookingId = payment.metadata?.bookingId;

        if (!bookingId) {
          console.error('Нет bookingId в metadata');
          return new Response('OK', { status: 200 });
        }

        const accessToken = await getFirebaseAccessToken(env);

        await updateBookingStatus(accessToken, env.PROJECT_ID, bookingId, {
          status: 'paid',
          paidAt: new Date().toISOString(),
          paymentId: payment.id
        });

        console.log('Бронь обновлена:', bookingId);
      }

      return new Response('OK', { status: 200 });
    } catch (err) {
      console.error('Ошибка:', err);
      return new Response('Error', { status: 500 });
    }
  }
};

async function getFirebaseAccessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: env.CLIENT_EMAIL,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  };

  const header = { alg: 'RS256', typ: 'JWT' };

  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(payload));
  const toSign = `${encodedHeader}.${encodedPayload}`;

  const privateKey = env.PRIVATE_KEY.replace(/\\n/g, '\n');
  const cryptoKey = await importPrivateKey(privateKey);

  const signature = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    cryptoKey,
    new TextEncoder().encode(toSign)
  );

  const encodedSignature = base64urlFromBuffer(signature);
  const jwt = `${toSign}.${encodedSignature}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    })
  });

  const data = await res.json();
  return data.access_token;
}

async function importPrivateKey(pem) {
  const pemContents = pem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '');

  const binaryDer = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));

  return await crypto.subtle.importKey(
    'pkcs8',
    binaryDer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

async function updateBookingStatus(accessToken, projectId, bookingId, fields) {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/bookings/${bookingId}?updateMask.fieldPaths=status&updateMask.fieldPaths=paidAt&updateMask.fieldPaths=paymentId`;

  const body = {
    fields: {
      status: { stringValue: fields.status },
      paidAt: { timestampValue: fields.paidAt },
      paymentId: { stringValue: fields.paymentId }
    }
  };

  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Firestore error: ${res.status} ${error}`);
  }
}

function base64url(str) {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlFromBuffer(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }
