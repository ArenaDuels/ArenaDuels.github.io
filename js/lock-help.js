// When the browser won't give the game the mouse (another program is holding it, say a shooter open in the
// background), the player sees a short explanation instead of a game that silently doesn't respond.

// One plain sentence on why the mouse couldn't be captured.
//   hasFocus   document.hasFocus(): is this window the one Windows thinks you are using?
//   errorName  the name of the error the browser gave for the request, if any
export function lockFailureReason({ hasFocus, errorName } = {}) {
  if (hasFocus === false) return "ArenaDuels isn't the active window, so the browser won't hand it the mouse. Another program may be keeping the focus.";
  if (errorName) return `The browser refused to give the game the mouse (${errorName}).`;
  return "The browser didn't give the game the mouse.";
}
