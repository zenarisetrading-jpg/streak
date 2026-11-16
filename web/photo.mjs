// Shrinks meal photos in the browser and asks the server to estimate photos or descriptions.
const MAX_SIDE = 1280;
const QUALITY = 0.82;
const MAX_FILE_BYTES = 30 * 1024 * 1024;

function loadImage(file) {
 return new Promise((resolve, reject) => {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => resolve({img, url});
  img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('This photo format could not be opened. Try a JPEG or PNG.')); };
  img.src = url;
 });
}

// Returns {mediaType, image (base64), previewUrl}. Always re-encodes as JPEG,
// which also strips location and camera metadata before upload.
export async function preparePhoto(file) {
 if (!file || !file.type.startsWith('image/')) throw new Error('Choose a photo.');
 if (file.size > MAX_FILE_BYTES) throw new Error('That photo is too large.');
 const {img, url} = await loadImage(file);
 const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
 const canvas = document.createElement('canvas');
 canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
 canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
 canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
 const dataUrl = canvas.toDataURL('image/jpeg', QUALITY);
 return {mediaType: 'image/jpeg', image: dataUrl.slice(dataUrl.indexOf(',') + 1), previewUrl: url};
}

export const analyzePhoto = (photo, hint = '') => requestEstimate({mediaType: photo.mediaType, image: photo.image, hint});
export const estimateText = text => requestEstimate({text});

async function requestEstimate(payload) {
 let response;
 try {
  response = await fetch('/api/meal-estimate', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload)});
 } catch {
  throw new Error('Could not reach the server. Check your connection, or reload the page to sign in again.');
 }
 const body = await response.json().catch(() => ({}));
 if (!response.ok) throw Object.assign(new Error(body.error || 'The estimate failed (' + response.status + ').'), {status: response.status});
 return body;
}
