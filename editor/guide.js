// The short on-screen guide and the complete Markdown handoff share the same dialog.
// Fetch the handoff before enabling Copy, so clipboard writing stays in the click gesture.
export function createFormatGuide(button, dialog) {
  const copy = dialog.querySelector('#copyAgent');
  const markdown = dialog.querySelector('#agentMarkdown');
  const status = dialog.querySelector('#agentCopyStatus');
  let loading = null, copiedTimer = 0;

  async function loadInstructions() {
    if (loading) return loading;
    copy.disabled = true;
    status.textContent = 'Loading the complete AI instructions…';
    loading = (async () => {
      try {
        const response = await fetch('../docs/PROMPT.md');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const text = await response.text();
        if (!text.trim()) throw new Error('Empty guide');
        markdown.value = text;
        copy.disabled = false;
        status.textContent = 'Copies the full Markdown guide, including examples and validation commands.';
      } catch {
        loading = null;
        status.textContent = 'Could not load the AI instructions. Close and reopen Format to try again.';
      }
    })();
    return loading;
  }

  button.onclick = async () => {
    dialog.showModal();
    dialog.querySelector('.formatBody').scrollTop = 0;
    await loadInstructions();
  };
  dialog.querySelector('#closeFormat').onclick = () => dialog.close();
  dialog.addEventListener('close', () => {
    clearTimeout(copiedTimer);
    copy.textContent = 'Copy for AI';
  });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });
  copy.onclick = async () => {
    clearTimeout(copiedTimer);
    try {
      await navigator.clipboard.writeText(markdown.value);
      copy.textContent = 'Copied';
      status.textContent = 'Copied the complete Markdown guide. Paste it into your AI chat with a description of your song.';
      copiedTimer = setTimeout(() => { copy.textContent = 'Copy for AI'; }, 2500);
    } catch {
      copy.textContent = 'Copy for AI';
      dialog.querySelector('#agentInstructions').open = true;
      markdown.focus();
      markdown.select();
      status.textContent = 'Automatic copying is unavailable. Copy the selected Markdown below, then paste it into your agent.';
    }
  };
}
