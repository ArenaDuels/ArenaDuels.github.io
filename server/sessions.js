// One account, one place at a time.
//
// Matchmaking and stats work per socket, so without this check a single account signed in
// on two tabs could be matched against itself and farm wins and kills. A socket that belongs
// to a signed-in account is "busy" while it is searching, waiting for a match to load, or in
// a room. Guests have no account (and no saved stats), so they are never busy here.
export function uidBusyElsewhere(clients, ws) {
  if (!ws.uid) return false;
  for (const other of clients) {
    if (other === ws || other.uid !== ws.uid) continue;
    if (other.readyState !== undefined && other.readyState !== other.OPEN) continue;
    if (other.searching || other.room || other.pendingRoom) return true;
  }
  return false;
}

// Is this account already in the room (on another socket)?
export function uidInRoom(room, ws) {
  if (!ws.uid) return false;
  for (const peer of room.members.values()) if (peer !== ws && peer.uid === ws.uid) return true;
  return false;
}
