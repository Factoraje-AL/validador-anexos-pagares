/* Envuelve el worker de Tesseract: los datos del idioma se sirven desde spa.json (base64). */
const realFetch = self.fetch.bind(self);
self.fetch = async (url, opts) => {
  if (String(url).includes('.traineddata')) {
    const j = await (await realFetch(new URL('spa.json', self.location.href))).json();
    const bin = atob(j.b64), u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return new Response(u.buffer, { status: 200 });
  }
  return realFetch(url, opts);
};
importScripts('worker.min.js');
