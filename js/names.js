// A pool of short, punchy words used to auto-generate a player name if
// they don't type their own. Picks one word + a 2-digit number.

export const NAME_WORDS = [
  "Blaze", "Nova", "Vortex", "Cipher", "Nomad", "Rogue", "Havoc", "Ember",
  "Frost", "Glitch", "Raptor", "Viper", "Comet", "Shadow", "Quartz", "Onyx",
  "Zenith", "Drift", "Static", "Volt", "Surge", "Nebula", "Vector", "Pulse",
  "Falcon", "Talon", "Wraith", "Specter", "Cinder", "Blitz", "Storm",
  "Tempest", "Rift", "Echo", "Vertex", "Prism", "Flux", "Turbo", "Rocket",
  "Meteor", "Aurora", "Eclipse", "Lunar", "Solar", "Photon", "Quantum",
  "Cobalt", "Chrome", "Crimson", "Scarlet", "Amber", "Jade", "Obsidian",
  "Ivory", "Rebel", "Maverick", "Outlaw", "Ranger", "Hunter", "Phantom",
  "Titan", "Rogue", "Bolt", "Spark", "Fury", "Venom", "Reaper", "Rocketeer",
];

export function randomName() {
  const word = NAME_WORDS[Math.floor(Math.random() * NAME_WORDS.length)];
  const num = Math.floor(Math.random() * 90 + 10); // 10-99
  return `${word}${num}`;
}
