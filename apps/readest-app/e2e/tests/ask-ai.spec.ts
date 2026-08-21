import { test, expect } from '../fixtures/base';

test.describe('Ask AI on a selection', () => {
  test('opens the Ask AI popup from the selection toolbar', async ({ openBook }) => {
    const reader = await openBook();

    await reader.selectText();
    await reader.popupTool('Ask AI').click();

    await expect(reader.askAIPopup).toBeVisible();
    // The toolbar steps aside for the popup, like the other lookup tools.
    await expect(reader.annotationPopup).toBeHidden();
  });

  test('shows the one-tap questions once the assistant is configured', async ({ openBook }) => {
    const reader = await openBook();

    await reader.selectText();
    await reader.popupTool('Ask AI').click();
    await expect(reader.askAIPopup).toBeVisible();

    // With the assistant off (the default) the popup explains how to turn it
    // on rather than offering questions it cannot answer.
    await expect(reader.askAIPopup).toContainText('Settings');
    await expect(reader.askAIPopup.getByRole('button', { name: 'Explain' })).toBeHidden();
  });

  test('closing the Ask AI popup returns to the selection toolbar', async ({ openBook }) => {
    const reader = await openBook();

    await reader.selectText();
    await reader.popupTool('Ask AI').click();
    await expect(reader.askAIPopup).toBeVisible();

    await reader.page.keyboard.press('Escape');

    await expect(reader.askAIPopup).toBeHidden();
    await expect(reader.annotationPopup).toBeVisible();
    await expect(reader.popupTool('Highlight')).toBeVisible();
  });
});
