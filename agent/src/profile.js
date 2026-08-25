const fs = require('fs');
const path = require('path');
const os = require('os');
const YAML = require('yaml');
const config = require('../data/config.json');

const LEGACY_PROFILE_DIR = '~/.myos/workspace/projects/personal/burning-man/profile';

function resolveDir(dir) {
  let target = dir || config.profile_dir || './profile';
  if (target.startsWith('~')) {
    target = path.join(os.homedir(), target.slice(1));
  } else if (!path.isAbsolute(target)) {
    target = path.resolve(__dirname, '..', target);
  }

  if (!dir && !fs.existsSync(target)) {
    const legacyExpanded = path.join(os.homedir(), LEGACY_PROFILE_DIR.slice(1));
    if (fs.existsSync(legacyExpanded)) {
      return legacyExpanded;
    }
  }

  return target;
}

function parseYamlFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    if (!content || !content.trim()) return null;
    return YAML.parse(content);
  } catch (err) {
    return null;
  }
}

function load(dir) {
  const profileDir = resolveDir(dir);

  const userData = parseYamlFile(path.join(profileDir, 'me.yaml')) || parseYamlFile(path.join(profileDir, 'joe.yaml')) || {};
  const musicData = parseYamlFile(path.join(profileDir, 'music.yaml')) || {};
  const partnerData = parseYamlFile(path.join(profileDir, 'partner.yaml')) || parseYamlFile(path.join(profileDir, 'alla.yaml')) || {};
  const friendsData = parseYamlFile(path.join(profileDir, 'friends.yaml')) || {};
  const mustDoData = parseYamlFile(path.join(profileDir, 'must-do.yaml')) || {};
  const favoritesData = parseYamlFile(path.join(profileDir, 'favorites.yaml')) || {};
  const sourcesData = parseYamlFile(path.join(profileDir, 'sources.yaml')) || {};

  const name = userData.name || 'You';
  const home = userData.home || { camp: '', address: '', note: '' };
  const tagWeights = userData.tag_weights || userData.tagWeights || {};
  const genreWeights = userData.genre_weights || userData.genreWeights || {};
  const timeOfDay = userData.time_of_day || userData.timeOfDay || {};
  const avoidTags = userData.avoid_tags || userData.avoidTags || [];
  const maxWalkMinutes = typeof userData.max_walk_minutes === 'number'
    ? userData.max_walk_minutes
    : (typeof userData.maxWalkMinutes === 'number' ? userData.maxWalkMinutes : 30);

  const rawTopArtists = musicData.top_artists || musicData.topArtists || [];
  const artists = rawTopArtists
    .map(a => (typeof a === 'string' ? a : (a && a.name ? a.name : '')))
    .filter(Boolean);
  const ambiguousIgnore = musicData.ambiguous_ignore || musicData.ambiguousIgnore || [];
  const watchDjs = musicData.watch_djs || musicData.watchDjs || [];

  const partner = {
    name: partnerData.name || 'Partner',
    weight: typeof partnerData.weight === 'number' ? partnerData.weight : 0.5,
    tagWeights: partnerData.tag_weights || partnerData.tagWeights || {},
    tag_weights: partnerData.tag_weights || partnerData.tagWeights || {},
    genreWeights: partnerData.genre_weights || partnerData.genreWeights || {},
    genre_weights: partnerData.genre_weights || partnerData.genreWeights || {}
  };

  const friends = friendsData.people || [];
  const mustDo = mustDoData.items || [];
  const favorites = favoritesData.items || [];
  const sources = sourcesData.sources || [];

  return {
    name,
    home,
    tagWeights,
    tag_weights: tagWeights,
    genreWeights,
    genre_weights: genreWeights,
    timeOfDay,
    time_of_day: timeOfDay,
    avoidTags,
    avoid_tags: avoidTags,
    maxWalkMinutes,
    max_walk_minutes: maxWalkMinutes,
    artists,
    topArtists: rawTopArtists,
    top_artists: rawTopArtists,
    ambiguousIgnore,
    ambiguous_ignore: ambiguousIgnore,
    watchDjs,
    watch_djs: watchDjs,
    partner,
    friends,
    mustDo,
    must_do: mustDo,
    favorites,
    sources
  };
}

function addFavorite(dir, eventId, note) {
  const profileDir = resolveDir(dir);
  if (!fs.existsSync(profileDir)) {
    fs.mkdirSync(profileDir, { recursive: true });
  }
  const favPath = path.join(profileDir, 'favorites.yaml');
  let data = parseYamlFile(favPath) || {};
  if (!data.items || !Array.isArray(data.items)) {
    data.items = [];
  }
  const newItem = typeof eventId === 'object' ? eventId : { id: eventId, note: note || '', added_at: new Date().toISOString() };
  data.items.push(newItem);
  fs.writeFileSync(favPath, YAML.stringify(data), 'utf8');
  return newItem;
}

function addFriend(dir, name, address, camp) {
  const profileDir = resolveDir(dir);
  if (!fs.existsSync(profileDir)) {
    fs.mkdirSync(profileDir, { recursive: true });
  }
  const friendsPath = path.join(profileDir, 'friends.yaml');
  let data = parseYamlFile(friendsPath) || {};
  if (!data.people || !Array.isArray(data.people)) {
    data.people = [];
  }
  const newPerson = { name, address, camp: camp || '' };
  data.people.push(newPerson);
  fs.writeFileSync(friendsPath, YAML.stringify(data), 'utf8');
  return newPerson;
}

module.exports = {
  load,
  addFavorite,
  addFriend,
  resolveDir
};
