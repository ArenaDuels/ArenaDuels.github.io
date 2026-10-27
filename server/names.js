// Player names.
//
// Every name the game hands out is  Adjective + Noun + two digits  (e.g. "SwiftViper42"),
// built from the lists below. That is 274 x 320 x 88 = about 7.7 million
// different names, all at most 16 characters.
//
// The server only lets an account be created with a name that came out of this
// generator (see isPossibleName), and only if the server itself offered that exact
// name a moment ago (see nameTickets.js) — so nobody can sign up with a name they made up.
//
// This file is used by the browser AND the relay server, and the two copies
// (js/names.js and server/names.js) must stay identical. It works with either
// Math.random (browser, guest names) or crypto.randomInt (server, account names).

// The original short list. Bot names still come from it (js/bots.js).
export const NAME_WORDS = [
  "Blaze", "Nova", "Vortex", "Cipher", "Nomad", "Rogue", "Havoc", "Ember", "Frost", "Glitch",
  "Raptor", "Viper", "Comet", "Shadow", "Quartz", "Onyx", "Zenith", "Drift", "Static", "Volt",
  "Surge", "Nebula", "Vector", "Pulse", "Falcon", "Talon", "Wraith", "Specter", "Cinder", "Blitz",
  "Storm", "Tempest", "Rift", "Echo", "Vertex", "Prism", "Flux", "Turbo", "Rocket", "Meteor",
  "Aurora", "Eclipse", "Lunar", "Solar", "Photon", "Quantum", "Cobalt", "Chrome", "Crimson",
  "Scarlet", "Amber", "Jade", "Obsidian", "Ivory", "Rebel", "Maverick", "Outlaw", "Ranger",
  "Hunter", "Phantom", "Titan", "Rogue", "Bolt", "Spark", "Fury", "Venom", "Reaper", "Rocketeer"
];

// The original account-name words. Accounts made before the big name list exist
// look like  Word + two digits  and must keep working at sign-in.
const LEGACY_NAME_WORDS = [
  "Blaze", "Nova", "Vortex", "Cipher", "Nomad", "Rogue", "Havoc", "Ember", "Frost", "Glitch",
  "Raptor", "Viper", "Comet", "Shadow", "Quartz", "Onyx", "Zenith", "Drift", "Static", "Volt",
  "Surge", "Nebula", "Vector", "Pulse", "Falcon", "Talon", "Wraith", "Specter", "Cinder", "Blitz",
  "Storm", "Tempest", "Rift", "Echo", "Vertex", "Prism", "Flux", "Turbo", "Rocket", "Meteor",
  "Aurora", "Eclipse", "Lunar", "Solar", "Photon", "Quantum", "Cobalt", "Chrome", "Crimson",
  "Scarlet", "Amber", "Jade", "Obsidian", "Ivory", "Rebel", "Maverick", "Outlaw", "Ranger",
  "Hunter", "Phantom", "Titan", "Bolt", "Spark", "Fury", "Venom", "Reaper", "Rocketeer"
];

export const NAME_ADJECTIVES = [
  "Swift", "Silent", "Crimson", "Neon", "Atomic", "Cosmic", "Rapid", "Lethal", "Savage", "Frozen",
  "Blazing", "Shadow", "Iron", "Steel", "Golden", "Silver", "Crystal", "Hyper", "Turbo", "Mega",
  "Super", "Alpha", "Omega", "Delta", "Gamma", "Sigma", "Prime", "Royal", "Rogue", "Rebel",
  "Stealth", "Phantom", "Ghost", "Mystic", "Arctic", "Solar", "Lunar", "Stellar", "Astral",
  "Nuclear", "Plasma", "Photon", "Cyber", "Digital", "Pixel", "Binary", "Quantum", "Fusion",
  "Ionic", "Vivid", "Bright", "Dark", "Pale", "Bold", "Brave", "Fierce", "Wild", "Feral", "Grim",
  "Stark", "Sharp", "Keen", "Quick", "Fast", "Nimble", "Agile", "Deft", "Sly", "Cunning",
  "Clever", "Wise", "Ancient", "Elder", "Eternal", "Endless", "Hollow", "Burning", "Molten",
  "Fiery", "Scarlet", "Violet", "Indigo", "Azure", "Cobalt", "Cyan", "Amber", "Jade", "Ivory",
  "Onyx", "Ebony", "Ashen", "Dusty", "Rusty", "Gilded", "Chrome", "Mirror", "Glassy", "Frosty",
  "Icy", "Snowy", "Stormy", "Windy", "Misty", "Foggy", "Cloudy", "Sunny", "Starry", "Dusky",
  "Mighty", "Humble", "Noble", "Loyal", "Lone", "Lucky", "Rare", "Epic", "Grand", "Great",
  "Giant", "Tiny", "Mini", "Micro", "Macro", "Active", "Alert", "Ready", "Steady", "Calm", "Cool",
  "Chill", "Frigid", "Toxic", "Acid", "Rabid", "Mad", "Wicked", "Crazy", "Furious", "Angry",
  "Brutal", "Vicious", "Deadly", "Fatal", "Mortal", "Fallen", "Risen", "Hidden", "Secret",
  "Covert", "Masked", "Veiled", "Unseen", "Unknown", "Lost", "Roaming", "Flying", "Soaring",
  "Rising", "Charged", "Voltaic", "Static", "Kinetic", "Dynamic", "Orbital", "Primal", "Raw",
  "Pure", "Wired", "Rigged", "Hacked", "Glitchy", "Retro", "Synth", "Techno", "Sonic", "Laser",
  "Rocket", "Jet", "Warp", "Hasty", "Zesty", "Jolly", "Merry", "Happy", "Lively", "Spicy",
  "Salty", "Sweet", "Minty", "Fuzzy", "Shiny", "Glossy", "Sleek", "Slick", "Smooth", "Rough",
  "Tough", "Rugged", "Sturdy", "Solid", "Dense", "Heavy", "Light", "Airy", "Fluffy", "Crisp",
  "Brisk", "Fresh", "Zen", "Magma", "Lava", "Coral", "Pearl", "Velvet", "Silken", "Cotton",
  "Woolly", "Copper", "Bronze", "Tin", "Zinc", "Nickel", "Carbon", "Argon", "Xenon", "Radon",
  "Helium", "Boron", "Meteor", "Nova", "Void", "Abyssal", "Mythic", "Legend", "Fabled", "Storied",
  "Heroic", "Valiant", "Gallant", "Daring", "Dashing", "Rowdy", "Rascal", "Sneaky", "Hushed",
  "Muted", "Thunder", "Roaring", "Howling", "Raging", "Glowing", "Radiant", "Beaming", "Flashy",
  "Flaring", "Sparky", "Zappy", "Buzzing", "Humming", "Snappy", "Crackle", "Cracked", "Broken",
  "Wanted", "Famous", "Elusive", "Evasive", "Limber", "Supple", "Wiry", "Burly", "Stout", "Hardy",
  "Robust"
];

export const NAME_NOUNS = [
  "Viper", "Falcon", "Raptor", "Wolf", "Fox", "Hawk", "Eagle", "Tiger", "Lion", "Panther",
  "Cobra", "Python", "Raven", "Crow", "Owl", "Shark", "Orca", "Dragon", "Phoenix", "Hydra",
  "Kraken", "Golem", "Titan", "Wizard", "Knight", "Ranger", "Hunter", "Sniper", "Pilot", "Rider",
  "Racer", "Runner", "Striker", "Slayer", "Reaper", "Warden", "Sentry", "Scout", "Ninja",
  "Samurai", "Ronin", "Viking", "Pirate", "Outlaw", "Bandit", "Nomad", "Drifter", "Wraith",
  "Specter", "Spirit", "Banshee", "Comet", "Meteor", "Nova", "Pulsar", "Quasar", "Nebula",
  "Galaxy", "Orbit", "Vortex", "Cyclone", "Typhoon", "Tempest", "Thunder", "Spark", "Ember",
  "Blaze", "Inferno", "Cinder", "Flare", "Torch", "Bolt", "Blade", "Dagger", "Saber", "Katana",
  "Spear", "Lance", "Arrow", "Axe", "Hammer", "Shield", "Armor", "Helm", "Cannon", "Rocket",
  "Missile", "Turret", "Bunker", "Citadel", "Tower", "Castle", "Anvil", "Forge", "Engine",
  "Piston", "Gear", "Circuit", "Cipher", "Matrix", "Vector", "Pixel", "Glitch", "Byte", "Codec",
  "Signal", "Pulse", "Echo", "Radar", "Sonar", "Beacon", "Lantern", "Prism", "Crystal", "Quartz",
  "Diamond", "Ruby", "Opal", "Topaz", "Garnet", "Emerald", "Cobalt", "Chrome", "Mirage",
  "Phantom", "Shadow", "Ghost", "Demon", "Angel", "Rogue", "Rebel", "Outcast", "Exile", "Hermit",
  "Monk", "Priest", "Oracle", "Prophet", "Sage", "Mage", "Warlock", "Witch", "Druid", "Shaman",
  "Bard", "Jester", "Joker", "Gambler", "Dealer", "Hustler", "Tycoon", "Baron", "Duke", "Earl",
  "Count", "King", "Queen", "Prince", "Emperor", "Captain", "Major", "Colonel", "General",
  "Marshal", "Sheriff", "Trooper", "Soldier", "Marine", "Raider", "Looter", "Courier", "Hacker",
  "Coder", "Driver", "Tanker", "Gunner", "Bomber", "Fighter", "Ace", "Wing", "Talon", "Claw",
  "Fang", "Horn", "Tusk", "Mane", "Pelt", "Hide", "Scale", "Shell", "Spine", "Quill", "Feather",
  "Beak", "Moth", "Wasp", "Hornet", "Beetle", "Spider", "Scorpio", "Mantis", "Cricket", "Locust",
  "Gecko", "Mamba", "Adder", "Rattler", "Jaguar", "Cougar", "Lynx", "Bobcat", "Ocelot", "Leopard",
  "Cheetah", "Badger", "Weasel", "Ferret", "Otter", "Beaver", "Moose", "Bison", "Mustang",
  "Bronco", "Mule", "Ram", "Bull", "Boar", "Stag", "Elk", "Yak", "Coyote", "Jackal", "Hyena",
  "Condor", "Osprey", "Kestrel", "Harrier", "Heron", "Crane", "Stork", "Swan", "Magpie", "Parrot",
  "Toucan", "Pelican", "Puffin", "Gannet", "Marlin", "Piranha", "Manta", "Pike", "Perch",
  "Salmon", "Turtle", "Lizard", "Iguana", "Newt", "Frog", "Toad", "Yeti", "Troll", "Ogre",
  "Goblin", "Orc", "Imp", "Sphinx", "Griffin", "Pegasus", "Unicorn", "Centaur", "Cyclops",
  "Chimera", "Wyvern", "Drake", "Goliath", "Atlas", "Apollo", "Ares", "Hermes", "Zeus", "Thor",
  "Odin", "Loki", "Freya", "Anubis", "Horus", "Osiris", "Mars", "Venus", "Saturn", "Jupiter",
  "Mercury", "Neptune", "Pluto", "Orion", "Lyra", "Vega", "Sirius", "Rigel", "Altair", "Polaris",
  "Antares", "Draco", "Cygnus", "Aquila", "Photon", "Proton", "Neutron", "Ion", "Quark", "Boson",
  "Tesla", "Edison", "Newton", "Kepler", "Galileo", "Pascal", "Fermi", "Bohr", "Curie"
];

// A few word pairs that run together into something rude. They are never handed out
// and never accepted. (names.test.js scans every pair, so a new word that makes a
// new accident fails the tests.)
const BANNED_STEMS = new Set([
  "chromethor", "chromethunder", "cloudykepler", "cloudykestrel", "cyanaltair", "endlessexile",
  "famousexile", "furiousexile", "hardykepler", "hardykestrel", "hollowhorn", "hollowhornet",
  "hollowhorus", "primethor", "primethunder", "rawhorn", "rawhornet", "rawhorus", "readykepler",
  "readykestrel", "rowdykepler", "rowdykestrel", "shadowhorn", "shadowhornet", "shadowhorus",
  "smoothotter", "steadykepler", "steadykestrel", "stealthotter", "sturdykepler", "sturdykestrel",
  "synthotter", "viciousexile", "windykepler", "windykestrel"
]);

// Two-digit endings that are never handed out: 69 and 88 (joke / hate-code numbers).
const SKIPPED_NUMBERS = new Set(["69", "88"]);
const MAX_NAME_LENGTH = 16;

// [min, max) like crypto.randomInt — the browser default uses Math.random.
const defaultRandomInt = (min, max) => min + Math.floor(Math.random() * (max - min));

/** A fresh random name. On the server pass crypto.randomInt for unpredictable ones. */
export function randomName(randomInt = defaultRandomInt) {
  for (;;) {
    const adjective = NAME_ADJECTIVES[randomInt(0, NAME_ADJECTIVES.length)];
    const noun = NAME_NOUNS[randomInt(0, NAME_NOUNS.length)];
    if (BANNED_STEMS.has((adjective + noun).toLowerCase())) continue;
    const digits = String(randomInt(10, 100));
    if (SKIPPED_NUMBERS.has(digits)) continue;
    return adjective + noun + digits;
  }
}

// lower-case "adjectivenoun" -> the name part in its proper capitals
let stemTable = null;
function stems() {
  if (stemTable) return stemTable;
  stemTable = new Map();
  for (const adjective of NAME_ADJECTIVES) {
    for (const noun of NAME_NOUNS) {
      const stem = adjective + noun;
      const key = stem.toLowerCase();
      if (!BANNED_STEMS.has(key) && !stemTable.has(key)) stemTable.set(key, stem);
    }
  }
  return stemTable;
}

/**
 * If `name` is exactly a name the generator can produce (any capitalisation), returns it
 * with the proper capitals; otherwise null.
 */
export function canonicalName(name) {
  if (typeof name !== "string" || name.length > MAX_NAME_LENGTH) return null;
  const match = /^([A-Za-z]+)([1-9][0-9])$/.exec(name);
  if (!match || SKIPPED_NUMBERS.has(match[2])) return null;
  const stem = stems().get(match[1].toLowerCase());
  return stem ? stem + match[2] : null;
}

/** Could the generator have produced this name? */
export const isPossibleName = (name) => canonicalName(name) !== null;

let legacyWords = null;
/** Is this an old-style account name (one word + two digits)? Only used so old accounts can still sign in. */
export function isLegacyName(name) {
  if (typeof name !== "string" || name.length > MAX_NAME_LENGTH) return false;
  const match = /^([A-Za-z]+)([1-9][0-9])$/.exec(name);
  if (!match) return false;
  legacyWords ||= new Set(LEGACY_NAME_WORDS.map((w) => w.toLowerCase()));
  return legacyWords.has(match[1].toLowerCase());
}

/** How many different names exist. */
export function possibleNameCount() {
  return stems().size * (90 - SKIPPED_NUMBERS.size);
}
