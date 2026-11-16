import { importText } from './library.js';

export function createOpenScore(button, dialog, onOpen) {
  const $ = id => dialog.querySelector('#' + id);
  const input = $('openFile'), text = $('openText'), status = $('openStatus'), submit = $('importScore');
  let reading = 0;
  button.onclick = () => {
    input.value = ''; text.value = ''; status.textContent = ''; submit.disabled = false;
    dialog.showModal();
  };
  $('cancelOpen').onclick = () => { reading++; dialog.close(); };
  dialog.addEventListener('close', () => { reading++; });
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    const ticket = ++reading;
    submit.disabled = true; status.textContent = `Reading ${file.name}…`;
    try {
      const value = await file.text();
      if (ticket !== reading) return;
      text.value = importText(value);
      status.textContent = `${file.name} is ready. You can review or edit it before opening.`;
    } catch (error) { if (ticket === reading) status.textContent = `Could not read that score: ${error.message}`; }
    finally { if (ticket === reading) submit.disabled = false; }
  };
  submit.onclick = async () => {
    submit.disabled = true;
    try {
      const value = importText(text.value);
      await onOpen(value, input.files[0]?.name.replace(/\.[^.]+$/, '') || 'Imported score');
      dialog.close();
    } catch (error) { status.textContent = error.message; }
    finally { submit.disabled = false; }
  };
}

export function createResetLibrary(button, dialog, { count, onReset }) {
  const status = dialog.querySelector('#resetStatus');
  let pending = null;
  button.onclick = () => {
    const n = count();
    dialog.querySelector('#resetCount').textContent = `${n} score${n === 1 ? '' : 's'} in the browser library.`;
    status.textContent = '';
    dialog.showModal();
  };
  dialog.querySelector('#cancelReset').onclick = () => dialog.close();
  dialog.addEventListener('close', () => pending?.abort());
  const confirm = dialog.querySelector('#confirmReset');
  confirm.onclick = async () => {
    confirm.disabled = true;
    pending = new AbortController();
    const operation = pending;
    try { await onReset(operation.signal); if (!operation.signal.aborted) dialog.close(); }
    catch { if (!operation.signal.aborted) status.textContent = 'Could not reset the browser library. Your scores have been kept. Try again.'; }
    finally { confirm.disabled = false; }
  };
}
