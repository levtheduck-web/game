#!/usr/bin/env node
// Fib Factory — a bluff-trivia party game (Fibbage-style).
//
//   npm install ws qrcode
//   node fib-factory-server.js
//
// Players connect via http://<host>:8100/ — server serves fib-factory.html
// and runs the WebSocket game on the same port.
//
// How it plays:
//   1. Host creates a room → gets a 4-letter code. Friends join with the code.
//      The host can pick a category (or Mixed).
//   2. Each round: a hard trivia question with a blank appears. Everyone secretly
//      writes a FAKE answer (a lie).
//   3. All the lies + the ONE real answer + a couple of believable "house decoys"
//      are shuffled and shown. Everyone votes for the answer they think is true.
//   4. Score: +1000 for picking the TRUTH, +500 for every player your lie fools.
//      (House decoys fool people but earn nobody points.)
//   5. Highest score after all rounds wins.

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { WebSocketServer } = require('ws');
let QRCode = null;
try { QRCode = require('qrcode'); } catch { /* optional */ }

const PORT = 8100;
const TRUTH_POINTS = 1000;
const FOOL_POINTS = 500;
const WRITE_SECONDS = 75;
const VOTE_SECONDS = 40;
const ROUNDS_DEFAULT = 5;
const MIN_OPTIONS = 6;       // pad the vote board with house decoys up to this many options
const MIN_DECOYS = 2;        // ...but always inject at least this many believable decoys when available

const CATEGORY_KEYS = ['mixed', 'science', 'history', 'animals', 'geography', 'language', 'weird'];

// ── Question bank: HARD, obscure-but-true trivia, each tagged with a category and
//    crafted believable decoys the game seeds into the vote board. ──
const QUESTIONS = [
  // ── SCIENCE ──
  { cat: 'science', prompt: "Because they're rich in potassium, bananas are naturally slightly ___.", answer: "radioactive", decoys: ["magnetic", "fluorescent", "acidic"] },
  { cat: 'science', prompt: "Venus is the only planet in our solar system that spins ___.", answer: "clockwise", decoys: ["on its side", "the fastest", "upside down"] },
  { cat: 'science', prompt: "An aircraft's 'black box' flight recorder is actually painted bright ___.", answer: "orange", decoys: ["yellow", "red", "silver"] },
  { cat: 'science', prompt: "An adult human skeleton has ___ bones — fewer than a newborn's.", answer: "206", decoys: ["198", "224", "187"] },
  { cat: 'science', prompt: "The oldest known living non-clonal tree, nicknamed Methuselah, is roughly ___ years old.", answer: "4,800", decoys: ["2,500", "9,500", "3,300"] },
  { cat: 'science', prompt: "A 'jiffy' is a genuine unit of time equal to ___ of a second.", answer: "one hundredth", decoys: ["one sixtieth", "one thousandth", "one tenth"] },
  { cat: 'science', prompt: "The earthy scent in the air after it rains is officially called ___.", answer: "petrichor", decoys: ["geosmin", "ozone", "mistral"] },
  { cat: 'science', prompt: "Astronauts have described the smell of outer space as most similar to ___.", answer: "seared steak", decoys: ["burnt almonds", "fresh paint", "sea salt"] },
  { cat: 'science', prompt: "The metal gallium will ___ from the warmth of your hand.", answer: "melt", decoys: ["spark", "harden", "glow"] },
  { cat: 'science', prompt: "There are more possible games of chess than there are ___ in the observable universe.", answer: "atoms", decoys: ["stars", "grains of sand", "water molecules"] },
  { cat: 'science', prompt: "The Eiffel Tower can grow about 15 cm taller during the ___.", answer: "summer", decoys: ["winter", "strongest winds", "rainy season"] },
  { cat: 'science', prompt: "The earliest oranges from Southeast Asia were actually the color ___.", answer: "green", decoys: ["yellow", "red", "brown"] },
  { cat: 'science', prompt: "A single teaspoonful of a neutron star would weigh about ___.", answer: "a billion tons", decoys: ["a ton", "a million tons", "a thousand tons"] },
  { cat: 'science', prompt: "Hot water can freeze faster than cold water — an effect named after a ___ schoolboy.", answer: "Tanzanian", decoys: ["Norwegian", "Russian", "Canadian"] },
  { cat: 'science', prompt: "Lightning strikes somewhere on Earth roughly ___ times every second.", answer: "100", decoys: ["10", "1,000", "8"] },
  { cat: 'science', prompt: "The human body contains enough ___ to make the lead for about 9,000 pencils.", answer: "carbon", decoys: ["graphite", "iron", "calcium"] },
  { cat: 'science', prompt: "Archaeologists have found pots of ___ in ancient Egyptian tombs that are still edible after 3,000 years.", answer: "honey", decoys: ["wine", "grain", "olive oil"] },
  { cat: 'science', prompt: "A bolt of lightning is roughly ___ times hotter than the surface of the Sun.", answer: "five", decoys: ["two", "twenty", "fifty"] },
  { cat: 'science', prompt: "Sharks are older than ___, having swum the oceans for over 400 million years.", answer: "trees", decoys: ["Mount Everest", "the Great Lakes", "the Amazon River"] },
  { cat: 'science', prompt: "Botanically, bananas are classified as ___ — but strawberries are not.", answer: "berries", decoys: ["nuts", "drupes", "melons"] },
  { cat: 'science', prompt: "Because of plate tectonics, Hawaii drifts about 10 cm closer to ___ every year.", answer: "Japan", decoys: ["California", "Alaska", "Australia"] },
  { cat: 'science', prompt: "On Venus, a single day lasts longer than an entire ___.", answer: "year", decoys: ["Earth month", "week", "season"] },
  { cat: 'science', prompt: "The Sun makes up about ___ of all the mass in our solar system.", answer: "99.8%", decoys: ["75%", "90%", "85%"] },
  { cat: 'science', prompt: "___ is the only planet in the solar system that would float if you dropped it in water.", answer: "Saturn", decoys: ["Neptune", "Uranus", "Mars"] },
  { cat: 'science', prompt: "The hottest planet in the solar system is ___, even though it isn't the closest to the Sun.", answer: "Venus", decoys: ["Mercury", "Mars", "Jupiter"] },
  { cat: 'science', prompt: "Humans share roughly ___ of their DNA with a banana.", answer: "60%", decoys: ["10%", "25%", "85%"] },
  { cat: 'science', prompt: "Light from the Sun takes about ___ minutes to reach Earth.", answer: "eight", decoys: ["two", "twenty", "forty"] },
  { cat: 'science', prompt: "By weight, spider silk is stronger than ___.", answer: "steel", decoys: ["concrete", "titanium", "diamond"] },
  { cat: 'science', prompt: "The most distant human-made object from Earth is the spacecraft ___.", answer: "Voyager 1", decoys: ["Voyager 2", "Pioneer 10", "New Horizons"] },
  { cat: 'science', prompt: "Chilled near absolute zero, liquid helium becomes a 'superfluid' that can crawl up and over the ___ of its container.", answer: "walls", decoys: ["lid", "spout", "handle"] },

  // ── HISTORY ──
  { cat: 'history', prompt: "In 1962, an epidemic of uncontrollable ___ shut down schools in Tanzania for over a year.", answer: "laughter", decoys: ["hiccups", "yawning", "fainting"] },
  { cat: 'history', prompt: "The longest war in history, between the Netherlands and the Isles of Scilly, lasted ___ years with no casualties.", answer: "335", decoys: ["68", "116", "204"] },
  { cat: 'history', prompt: "Oxford University is older than the ___ Empire.", answer: "Aztec", decoys: ["Ottoman", "Mongol", "Inca"] },
  { cat: 'history', prompt: "The first product ever scanned with a barcode was a pack of ___.", answer: "chewing gum", decoys: ["cigarettes", "Coca-Cola", "razor blades"] },
  { cat: 'history', prompt: "The 'Hundred Years' War' actually lasted ___ years.", answer: "116", decoys: ["99", "127", "144"] },
  { cat: 'history', prompt: "Sections of the Great Wall of China were held together by mortar made with sticky ___.", answer: "rice", decoys: ["mud", "egg whites", "tree sap"] },
  { cat: 'history', prompt: "In its original 1880s recipe, Coca-Cola contained trace amounts of ___.", answer: "cocaine", decoys: ["morphine", "nicotine", "opium"] },
  { cat: 'history', prompt: "Cleopatra lived closer in time to the first ___ than to the building of the Great Pyramid.", answer: "Moon landing", decoys: ["printing press", "Roman Colosseum", "Eiffel Tower"] },
  { cat: 'history', prompt: "Ancient Romans used human ___ as a mouthwash, even importing it from Portugal.", answer: "urine", decoys: ["wine", "vinegar", "ash"] },
  { cat: 'history', prompt: "The Great Fire of London in 1666 reportedly killed only ___ people.", answer: "six", decoys: ["forty", "hundreds", "thousands"] },
  { cat: 'history', prompt: "In 1807, Napoleon and his men were famously chased off by a swarm of ___.", answer: "rabbits", decoys: ["bees", "geese", "stray cats"] },
  { cat: 'history', prompt: "Before alarm clocks, 'knocker-uppers' woke workers by tapping their ___ with long poles.", answer: "windows", decoys: ["doors", "shoulders", "feet"] },
  { cat: 'history', prompt: "The workers who built the Egyptian pyramids were partly paid in ___.", answer: "beer", decoys: ["gold", "salt", "livestock"] },
  { cat: 'history', prompt: "The English word 'salary' comes from the Latin for ___, which Roman soldiers were partly paid in.", answer: "salt", decoys: ["silver", "gold", "grain"] },
  { cat: 'history', prompt: "The shortest war in recorded history, between Britain and Zanzibar in 1896, lasted about ___ minutes.", answer: "38", decoys: ["90", "12", "150"] },
  { cat: 'history', prompt: "From 1900 to 1920, ___ was an official event at the Olympic Games.", answer: "tug of war", decoys: ["thumb wrestling", "arm wrestling", "sack racing"] },
  { cat: 'history', prompt: "The popular image of Vikings wearing ___ helmets was actually invented for a 19th-century opera.", answer: "horned", decoys: ["winged", "golden", "spiked"] },
  { cat: 'history', prompt: "Napoleon was actually of ___ height for his era; the 'short' myth came from confusing French and English inches.", answer: "average", decoys: ["well below-average", "exceptional", "tiny"] },
  { cat: 'history', prompt: "France carried out its last execution by ___ in 1977, the same year Star Wars premiered.", answer: "guillotine", decoys: ["firing squad", "hanging", "electric chair"] },
  { cat: 'history', prompt: "The Eiffel Tower was originally meant to be ___ after just 20 years.", answer: "torn down", decoys: ["painted gold", "doubled in height", "moved to America"] },
  { cat: 'history', prompt: "In 1700s England, ___ were so expensive that people rented them just to show off at parties.", answer: "pineapples", decoys: ["lemons", "lobsters", "umbrellas"] },
  { cat: 'history', prompt: "Surprisingly, the ___ was patented decades before the telephone.", answer: "fax machine", decoys: ["light bulb", "phonograph", "radio"] },
  { cat: 'history', prompt: "King Henry VIII employed a trusted servant called the Groom of the ___, who attended to the royal toilet.", answer: "Stool", decoys: ["Chamber", "Robe", "Bath"] },
  { cat: 'history', prompt: "Athletes in the ancient Greek Olympics competed completely ___.", answer: "nude", decoys: ["barefoot", "masked", "in armor"] },
  { cat: 'history', prompt: "Before becoming president, Abraham Lincoln was a skilled ___, losing only one of around 300 matches.", answer: "wrestler", decoys: ["boxer", "fencer", "marksman"] },
  { cat: 'history', prompt: "The world's first computer programmer, who wrote an algorithm in the 1840s, was ___.", answer: "Ada Lovelace", decoys: ["Alan Turing", "Grace Hopper", "Charles Babbage"] },
  { cat: 'history', prompt: "The Great Pyramid of Giza remained the tallest structure on Earth for nearly ___ years.", answer: "3,800", decoys: ["800", "1,500", "6,000"] },
  { cat: 'history', prompt: "The teddy bear is named after U.S. President ___.", answer: "Theodore Roosevelt", decoys: ["Franklin Roosevelt", "Abraham Lincoln", "Benjamin Harrison"] },
  { cat: 'history', prompt: "The first message ever sent over the internet was '___' — the system crashed mid-word.", answer: "lo", decoys: ["hello", "test", "hi"] },
  { cat: 'history', prompt: "Lady Jane Grey was Queen of England for only about ___ days.", answer: "nine", decoys: ["three", "forty", "ninety"] },

  // ── ANIMALS ──
  { cat: 'animals', prompt: "A group of hippos is called a ___.", answer: "bloat", decoys: ["wallow", "pod", "crash"] },
  { cat: 'animals', prompt: "Counting the smaller ones in each of its arms, an octopus has ___ brains.", answer: "nine", decoys: ["three", "five", "eight"] },
  { cat: 'animals', prompt: "The collective noun for a group of pandas is an ___.", answer: "embarrassment", decoys: ["awkwardness", "bamboozle", "cuddle"] },
  { cat: 'animals', prompt: "Sea cucumbers breathe through their ___.", answer: "anus", decoys: ["skin", "gills", "feet"] },
  { cat: 'animals', prompt: "A shrimp's heart is located in its ___.", answer: "head", decoys: ["tail", "abdomen", "throat"] },
  { cat: 'animals', prompt: "An octopus's blood is blue because it carries oxygen using ___ instead of iron.", answer: "copper", decoys: ["cobalt", "zinc", "silver"] },
  { cat: 'animals', prompt: "A group of flamingos is called a ___.", answer: "flamboyance", decoys: ["flutter", "stand", "shimmer"] },
  { cat: 'animals', prompt: "Wombats are unique among animals for producing ___-shaped droppings.", answer: "cube", decoys: ["star", "spiral", "pellet"] },
  { cat: 'animals', prompt: "More people are killed each year by ___ than by sharks.", answer: "cows", decoys: ["falling coconuts", "hippos", "champagne corks"] },
  { cat: 'animals', prompt: "There is a species of jellyfish that is considered biologically ___.", answer: "immortal", decoys: ["invisible", "silent", "blind"] },
  { cat: 'animals', prompt: "A 'murmuration' is the collective noun for a swirling group of ___.", answer: "starlings", decoys: ["crows", "bats", "sparrows"] },
  { cat: 'animals', prompt: "The pistol shrimp snaps its claw so fast it creates a bubble nearly as hot as the ___.", answer: "sun", decoys: ["surface of Venus", "Earth's core", "inside of a volcano"] },
  { cat: 'animals', prompt: "A group of crows is a 'murder'; a group of lemurs is a ___.", answer: "conspiracy", decoys: ["mischief", "troop", "shadow"] },
  { cat: 'animals', prompt: "Studies show cows produce more ___ when they listen to calming music.", answer: "milk", decoys: ["methane", "saliva", "body heat"] },
  { cat: 'animals', prompt: "A tarantula can survive for over ___ without eating any food.", answer: "two years", decoys: ["one month", "six months", "ten years"] },
  { cat: 'animals', prompt: "An octopus has three ___.", answer: "hearts", decoys: ["stomachs", "eyes", "tongues"] },
  { cat: 'animals', prompt: "Snails can sleep for up to ___ at a stretch.", answer: "three years", decoys: ["three days", "three weeks", "three months"] },
  { cat: 'animals', prompt: "Flamingos are born grey and turn pink because of the ___ in their diet.", answer: "shrimp", decoys: ["worms", "seaweed", "insects"] },
  { cat: 'animals', prompt: "A group of owls is called a ___.", answer: "parliament", decoys: ["congress", "court", "senate"] },
  { cat: 'animals', prompt: "By slowing their heart rate, sloths can hold their breath longer than ___.", answer: "dolphins", decoys: ["seals", "whales", "humans"] },
  { cat: 'animals', prompt: "Because of how their tails and legs work, kangaroos physically cannot ___.", answer: "walk backwards", decoys: ["swim", "jump on one leg", "stand still"] },
  { cat: 'animals', prompt: "Domestic cats are completely unable to taste ___.", answer: "sweetness", decoys: ["salt", "bitterness", "sourness"] },
  { cat: 'animals', prompt: "Elephants are one of the only mammals that cannot ___.", answer: "jump", decoys: ["swim", "lie down", "run"] },
  { cat: 'animals', prompt: "A hummingbird's heart can beat over ___ times per minute.", answer: "1,200", decoys: ["200", "500", "5,000"] },
  { cat: 'animals', prompt: "A reindeer's eyes change color from gold in summer to ___ in winter.", answer: "blue", decoys: ["green", "red", "silver"] },
  { cat: 'animals', prompt: "The axolotl can regrow its limbs and even parts of its ___.", answer: "brain", decoys: ["shell", "wings", "skeleton"] },
  { cat: 'animals', prompt: "Underneath their white fur, polar bears actually have ___ skin.", answer: "black", decoys: ["pink", "grey", "blue"] },
  { cat: 'animals', prompt: "A blue whale's heart is roughly the size of a ___.", answer: "small car", decoys: ["basketball", "refrigerator", "dinner plate"] },
  { cat: 'animals', prompt: "If you shaved a tiger, you'd discover that its ___ is striped too.", answer: "skin", decoys: ["fat", "muscle", "tongue"] },
  { cat: 'animals', prompt: "Goats and many grazing animals have ___-shaped pupils.", answer: "rectangular", decoys: ["star", "round", "triangular"] },

  // ── GEOGRAPHY ──
  { cat: 'geography', prompt: "The largest desert in the world by area is ___.", answer: "Antarctica", decoys: ["the Sahara", "the Arabian Desert", "the Gobi"] },
  { cat: 'geography', prompt: "The shortest scheduled airline flight in the world lasts about ___.", answer: "90 seconds", decoys: ["four minutes", "ten minutes", "two minutes"] },
  { cat: 'geography', prompt: "The longest place name in the world, a hill in New Zealand, has ___ letters.", answer: "85", decoys: ["57", "92", "45"] },
  { cat: 'geography', prompt: "The only letter that does not appear in the name of any U.S. state is ___.", answer: "Q", decoys: ["Z", "X", "J"] },
  { cat: 'geography', prompt: "The unicorn is the official national animal of ___.", answer: "Scotland", decoys: ["Wales", "Iceland", "Portugal"] },
  { cat: 'geography', prompt: "Russia is so wide that it spans ___ time zones.", answer: "eleven", decoys: ["nine", "seven", "fifteen"] },
  { cat: 'geography', prompt: "Africa is the only continent that sits in all four ___.", answer: "hemispheres", decoys: ["oceans", "tectonic plates", "climate zones"] },
  { cat: 'geography', prompt: "Canada contains more ___ than the rest of the world combined.", answer: "lakes", decoys: ["coastline", "freshwater", "islands"] },
  { cat: 'geography', prompt: "The highest capital city in the world, La Paz, is located in ___.", answer: "Bolivia", decoys: ["Peru", "Nepal", "Ecuador"] },
  { cat: 'geography', prompt: "The Sahara Desert is roughly the same size as the entire ___.", answer: "United States", decoys: ["European Union", "Australia", "Amazon rainforest"] },
  { cat: 'geography', prompt: "Istanbul is the only major city in the world that sits on two ___.", answer: "continents", decoys: ["seas", "tectonic plates", "rivers"] },
  { cat: 'geography', prompt: "Saudi Arabia imports ___ from Australia.", answer: "camels", decoys: ["sand", "kangaroos", "bottled water"] },
  { cat: 'geography', prompt: "From east to west, Australia is actually wider than the ___.", answer: "Moon", decoys: ["United States", "Atlantic Ocean", "Sahara"] },
  { cat: 'geography', prompt: "At the remote ocean spot called Point Nemo, the nearest humans are often astronauts aboard the ___.", answer: "International Space Station", decoys: ["nearest cargo ship", "South Pole base", "nearest island"] },
  { cat: 'geography', prompt: "Each year the Atlantic Ocean grows wider while the ___ Ocean slowly shrinks.", answer: "Pacific", decoys: ["Indian", "Arctic", "Southern"] },
  { cat: 'geography', prompt: "Measured from the center of the Earth, the highest point on the planet is Mount ___ in Ecuador — not Everest.", answer: "Chimborazo", decoys: ["Aconcagua", "Cotopaxi", "Kilimanjaro"] },
  { cat: 'geography', prompt: "The mountain kingdom of Lesotho is completely surrounded by a single country: ___.", answer: "South Africa", decoys: ["Botswana", "Namibia", "Zimbabwe"] },
  { cat: 'geography', prompt: "The smallest country in the world by area is ___.", answer: "Vatican City", decoys: ["Monaco", "San Marino", "Nauru"] },
  { cat: 'geography', prompt: "The U.S. state geographically closest to Africa is ___.", answer: "Maine", decoys: ["Florida", "Texas", "South Carolina"] },
  { cat: 'geography', prompt: "Alaska is the most western U.S. state — but because its Aleutian Islands cross the 180° line, it is also the most ___.", answer: "eastern", decoys: ["northern", "southern", "remote"] },
  { cat: 'geography', prompt: "The lowest exposed point of land on Earth is the shore of the ___.", answer: "Dead Sea", decoys: ["Caspian Sea", "Grand Canyon", "Death Valley"] },
  { cat: 'geography', prompt: "At their closest islands, Russia and the United States are less than ___ apart.", answer: "three miles", decoys: ["fifty miles", "ten miles", "one hundred miles"] },
  { cat: 'geography', prompt: "Despite its name, ___ is mostly covered in ice, while Iceland is mostly green.", answer: "Greenland", decoys: ["Finland", "Lapland", "Svalbard"] },
  { cat: 'geography', prompt: "The driest non-polar place on Earth is the ___ Desert in Chile.", answer: "Atacama", decoys: ["Mojave", "Kalahari", "Sonoran"] },
  { cat: 'geography', prompt: "The deepest point in any ocean, the Challenger Deep, lies in the ___ Trench.", answer: "Mariana", decoys: ["Java", "Tonga", "Puerto Rico"] },
  { cat: 'geography', prompt: "Because it straddles the date line, the Pacific nation of Kiribati can be in ___ different days at the same time.", answer: "two", decoys: ["three", "four", "five"] },
  { cat: 'geography', prompt: "Counting every fjord and island, Norway's coastline is long enough to wrap around the Earth about ___ times.", answer: "two and a half", decoys: ["one", "ten", "twenty"] },
  { cat: 'geography', prompt: "The largest lake (or inland sea) on Earth by area is the ___.", answer: "Caspian Sea", decoys: ["Lake Superior", "Lake Victoria", "Black Sea"] },
  { cat: 'geography', prompt: "The country with the longest total coastline in the world is ___.", answer: "Canada", decoys: ["Russia", "Indonesia", "Australia"] },
  { cat: 'geography', prompt: "The Sargasso Sea is the only sea on Earth with no ___.", answer: "coastline", decoys: ["tides", "seaweed", "fish"] },

  // ── LANGUAGE ──
  { cat: 'language', prompt: "The little plastic or metal tip at the end of a shoelace is called an ___.", answer: "aglet", decoys: ["aiguillette", "ferrule", "grommet"] },
  { cat: 'language', prompt: "The hashtag symbol (#) is technically named the ___.", answer: "octothorpe", decoys: ["interrobang", "pilcrow", "obelus"] },
  { cat: 'language', prompt: "The dot over a lowercase 'i' or 'j' is called a ___.", answer: "tittle", decoys: ["jot", "serif", "cusp"] },
  { cat: 'language', prompt: "One study claims Scots have 421 different words for ___.", answer: "snow", decoys: ["rain", "mud", "drunk"] },
  { cat: 'language', prompt: "The only common English word that ends in the letters '-mt' is ___.", answer: "dreamt", decoys: ["unkempt", "exempt", "contempt"] },
  { cat: 'language', prompt: "A misheard song lyric, like 'wrapped up like a douche', is called a ___.", answer: "mondegreen", decoys: ["malapropism", "spoonerism", "eggcorn"] },
  { cat: 'language', prompt: "The QWERTY keyboard layout was reportedly designed in the 1870s to ___ typists.", answer: "slow down", decoys: ["speed up", "retrain", "standardize"] },
  { cat: 'language', prompt: "A word that spells a different word backwards (like 'stressed' / 'desserts') is a ___.", answer: "semordnilap", decoys: ["anadrome", "reversogram", "backonym"] },
  { cat: 'language', prompt: "A sentence using every letter of the alphabet, like 'the quick brown fox...', is a ___.", answer: "pangram", decoys: ["lipogram", "isogram", "anagram"] },
  { cat: 'language', prompt: "The infinity symbol (∞) is formally called a ___.", answer: "lemniscate", decoys: ["vinculum", "ouroboros", "obelus"] },
  { cat: 'language', prompt: "The smooth patch of skin between your eyebrows is called the ___.", answer: "glabella", decoys: ["philtrum", "nasion", "frenulum"] },
  { cat: 'language', prompt: "The vertical groove between your nose and upper lip is the ___.", answer: "philtrum", decoys: ["glabella", "columella", "vermilion"] },
  { cat: 'language', prompt: "The most frequently used letter in the English language is ___.", answer: "E", decoys: ["T", "A", "S"] },
  { cat: 'language', prompt: "Swapping the first sounds of two words, like 'belly jeans' for 'jelly beans', is called a ___.", answer: "spoonerism", decoys: ["malapropism", "mondegreen", "metathesis"] },
  { cat: 'language', prompt: "The word 'bookkeeper' is unusual for containing three consecutive ___.", answer: "double letters", decoys: ["silent letters", "vowels", "hard consonants"] },
  { cat: 'language', prompt: "Often called the longest English word with no true vowel (a, e, i, o, u) is ___.", answer: "rhythms", decoys: ["crypts", "glyphs", "nymphs"] },
  { cat: 'language', prompt: "With nine letters and only one vowel, ___ is one of the longest one-syllable words in English.", answer: "strengths", decoys: ["scratched", "screeched", "stretched"] },
  { cat: 'language', prompt: "The symbol '&' was once treated as the ___th letter of the English alphabet.", answer: "27", decoys: ["24", "26", "30"] },
  { cat: 'language', prompt: "The rare punctuation mark combining a question mark and an exclamation point is the ___.", answer: "interrobang", decoys: ["octothorpe", "pilcrow", "guillemet"] },
  { cat: 'language', prompt: "The paragraph symbol (¶) is properly called the ___.", answer: "pilcrow", decoys: ["octothorpe", "dagger", "caret"] },
  { cat: 'language', prompt: "The 29-letter word 'floccinaucinihilipilification' means the act of judging something to be ___.", answer: "worthless", decoys: ["priceless", "sacred", "delicious"] },
  { cat: 'language', prompt: "A piece of writing that deliberately avoids one letter of the alphabet is called a ___.", answer: "lipogram", decoys: ["pangram", "isogram", "anagram"] },
  { cat: 'language', prompt: "The longest common English word with all its letters in alphabetical order is ___.", answer: "almost", decoys: ["biopsy", "chintz", "begins"] },
  { cat: 'language', prompt: "The word 'goodbye' began as a contraction of the phrase 'God be with ___.'", answer: "ye", decoys: ["thee", "us", "all"] },
  { cat: 'language', prompt: "In its original Middle English meaning, the word 'nice' actually meant ___.", answer: "foolish", decoys: ["kind", "clean", "wealthy"] },
  { cat: 'language', prompt: "The word 'avocado' comes from an Aztec word meaning ___.", answer: "testicle", decoys: ["butter", "green gold", "alligator"] },
  { cat: 'language', prompt: "The word 'quarantine' comes from the Italian for '___ days', the time plague ships had to wait.", answer: "forty", decoys: ["thirty", "ten", "one hundred"] },
  { cat: 'language', prompt: "The word 'muscle' comes from a Latin word meaning 'little ___.'", answer: "mouse", decoys: ["wave", "rope", "knot"] },
  { cat: 'language', prompt: "A word or phrase that reads the same backward as forward is a ___.", answer: "palindrome", decoys: ["anagram", "semordnilap", "pangram"] },
  { cat: 'language', prompt: "Many believe 'OK' started in the 1830s as a jokey misspelling of 'oll ___.'", answer: "korrect", decoys: ["clear", "ready", "good"] },

  // ── WEIRD & RANDOM ──
  { cat: 'weird', prompt: "Part of the ashes of the man who invented the Pringles can were buried inside ___.", answer: "a Pringles can", decoys: ["a potato field", "a Coca-Cola bottle", "his garden"] },
  { cat: 'weird', prompt: "The 'WD' in WD-40 stands for 'Water ___'.", answer: "Displacement", decoys: ["Defense", "Dispersant", "Diluting"] },
  { cat: 'weird', prompt: "The longest recorded gap between the birth of two twins is 87 ___.", answer: "days", decoys: ["minutes", "hours", "weeks"] },
  { cat: 'weird', prompt: "Until the 1970s, tennis balls were traditionally the color ___.", answer: "white", decoys: ["black", "grey", "red"] },
  { cat: 'weird', prompt: "Competitive eater Joey Chestnut holds the record for eating 76 ___ in ten minutes.", answer: "hot dogs", decoys: ["tacos", "oysters", "hard-boiled eggs"] },
  { cat: 'weird', prompt: "The 'M's in M&M's stand for Mars and ___.", answer: "Murrie", decoys: ["Morrison", "Miller", "Mathers"] },
  { cat: 'weird', prompt: "Bubble wrap was originally invented to be sold as textured ___.", answer: "wallpaper", decoys: ["greenhouse insulation", "packing peanuts", "raincoats"] },
  { cat: 'weird', prompt: "In the 1830s, ketchup was actually sold as a ___.", answer: "medicine", decoys: ["paint", "glue", "perfume"] },
  { cat: 'weird', prompt: "The inventor of the modern frisbee had his ashes turned, after death, into a ___.", answer: "frisbee", decoys: ["paperweight", "trophy", "kite"] },
  { cat: 'weird', prompt: "The world record for the longest time a human has gone without ___ is 11 days.", answer: "sleep", decoys: ["food", "water", "speaking"] },
  { cat: 'weird', prompt: "Founded in 1889, the company Nintendo originally made ___.", answer: "playing cards", decoys: ["toys", "vacuum cleaners", "instant rice"] },
  { cat: 'weird', prompt: "Cotton candy was co-invented by a ___.", answer: "dentist", decoys: ["barber", "chef", "magician"] },
  { cat: 'weird', prompt: "The microwave oven was invented after an engineer noticed a ___ melting in his pocket near radar equipment.", answer: "chocolate bar", decoys: ["pen", "watch", "sandwich"] },
  { cat: 'weird', prompt: "Play-Doh was originally sold as a ___ cleaner.", answer: "wallpaper", decoys: ["carpet", "oven", "jewelry"] },
  { cat: 'weird', prompt: "The Slinky was invented by accident by an engineer trying to make springs for ___.", answer: "ships", decoys: ["watches", "cars", "pianos"] },
  { cat: 'weird', prompt: "Without its caramel coloring, Coca-Cola would actually be ___.", answer: "green", decoys: ["clear", "brown", "yellow"] },
  { cat: 'weird', prompt: "Velcro was invented after a Swiss engineer examined the ___ stuck to his dog's fur.", answer: "burrs", decoys: ["ticks", "mud", "leaves"] },
  { cat: 'weird', prompt: "The very first item ever sold on eBay was a broken ___.", answer: "laser pointer", decoys: ["calculator", "watch", "typewriter"] },
  { cat: 'weird', prompt: "Apple's very first logo, from 1976, depicted ___ sitting under a tree.", answer: "Isaac Newton", decoys: ["Steve Jobs", "Adam and Eve", "Alan Turing"] },
  { cat: 'weird', prompt: "Ironically, one of the most frequently stolen books from libraries is the ___.", answer: "Guinness Book of World Records", decoys: ["Bible", "dictionary", "Harry Potter series"] },
  { cat: 'weird', prompt: "For historical engineering reasons, the standard snooze button delays your alarm by about ___ minutes.", answer: "nine", decoys: ["five", "ten", "seven"] },
  { cat: 'weird', prompt: "The original 1891 toilet paper patent clearly shows the roll hanging ___.", answer: "over", decoys: ["under", "sideways", "either way"] },
  { cat: 'weird', prompt: "McDonald's once tested a ___-flavored broccoli for kids, which only confused them.", answer: "bubblegum", decoys: ["chocolate", "cheeseburger", "strawberry"] },
  { cat: 'weird', prompt: "Ernő Rubik, the inventor of the Rubik's Cube, took about a ___ to first solve his own puzzle.", answer: "month", decoys: ["day", "week", "year"] },
  { cat: 'weird', prompt: "There are now more plastic pink ___ in the world than real ones.", answer: "flamingos", decoys: ["palm trees", "ducks", "garden gnomes"] },
  { cat: 'weird', prompt: "An American man named Charles Osborne had the hiccups continuously for ___ years.", answer: "68", decoys: ["12", "30", "100"] },
  { cat: 'weird', prompt: "A single stock sound effect, the 'Wilhelm ___', has been reused in hundreds of movies.", answer: "scream", decoys: ["whistle", "crash", "laugh"] },
  { cat: 'weird', prompt: "The first toy ever advertised on television was ___.", answer: "Mr. Potato Head", decoys: ["Barbie", "the Slinky", "Lego"] },
  { cat: 'weird', prompt: "The Bluetooth logo is made from the runic initials of a 10th-century ___ king.", answer: "Viking", decoys: ["Saxon", "Scottish", "Frankish"] },
  { cat: 'weird', prompt: "The famous Windows XP 'Bliss' wallpaper is a real, unedited photo of green hills in ___.", answer: "California", decoys: ["New Zealand", "Ireland", "Switzerland"] },
];

// Precompute how many questions live in each category (for the lobby picker).
const CAT_COUNTS = {};
for (const q of QUESTIONS) CAT_COUNTS[q.cat] = (CAT_COUNTS[q.cat] || 0) + 1;
CAT_COUNTS.mixed = QUESTIONS.length;

function shuffle(a) {
  // Fisher–Yates. Avoids Math.random ordering bias.
  const arr = a.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
function roomCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O to avoid confusion
  let c = '';
  for (let i = 0; i < 4; i++) c += letters[Math.floor(Math.random() * letters.length)];
  return c;
}

// ── Rooms ────────────────────────────────────────────────────────────
const rooms = new Map(); // code -> room

function makeRoom() {
  let code;
  do { code = roomCode(); } while (rooms.has(code));
  const room = {
    code,
    players: new Map(),       // id -> {id, name, ws, score, connected, lie, votedFor, isHost}
    hostId: null,
    phase: 'lobby',           // lobby | writing | voting | reveal | final
    round: 0,
    totalRounds: ROUNDS_DEFAULT,
    category: 'mixed',
    usedQuestions: [],
    question: null,           // {cat, prompt, answer, decoys}
    answers: [],              // voting list: {id, text, authorIds:[], isTruth, isDecoy}
    timer: 0,
    timerHandle: null,
    nextId: 1,
  };
  rooms.set(code, room);
  return room;
}

function send(ws, obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function activePlayers(room) {
  return [...room.players.values()].filter(p => p.connected);
}

// Build the per-player view of the room and broadcast it.
function broadcast(room) {
  const playerList = [...room.players.values()].map(p => ({
    id: p.id, name: p.name, score: p.score, connected: p.connected,
    isHost: p.id === room.hostId,
    done: room.phase === 'writing' ? (p.lie != null)
        : room.phase === 'voting' ? (p.votedFor != null)
        : false,
  }));

  for (const p of room.players.values()) {
    if (!p.connected) continue;
    const base = {
      t: 'state',
      code: room.code,
      phase: room.phase,
      you: p.id,
      isHost: p.id === room.hostId,
      round: room.round,
      totalRounds: room.totalRounds,
      category: room.category,
      timer: room.timer,
      players: playerList,
    };
    if (room.phase === 'lobby') base.catCounts = CAT_COUNTS;

    if (room.phase === 'writing') {
      base.prompt = room.question.prompt;
      base.myLie = p.lie || null;
    } else if (room.phase === 'voting') {
      base.prompt = room.question.prompt;
      // Hide authorship; mark which option (if any) is this player's own lie.
      base.answers = room.answers.map(a => ({
        id: a.id, text: a.text,
        mine: a.authorIds.includes(p.id),
      }));
      base.myVote = p.votedFor || null;
    } else if (room.phase === 'reveal') {
      base.prompt = room.question.prompt;
      base.truth = room.question.answer;
      base.answers = room.answers.map(a => ({
        id: a.id, text: a.text, isTruth: a.isTruth, isDecoy: a.isDecoy,
        authors: a.authorIds.map(id => room.players.get(id)?.name).filter(Boolean),
        voters: [...room.players.values()].filter(v => v.votedFor === a.id).map(v => v.name),
        points: a.points || 0, // points each author earned from this answer
      }));
      base.roundScores = room.lastRoundScores || {};
    } else if (room.phase === 'final') {
      base.ranking = [...room.players.values()]
        .map(pl => ({ name: pl.name, score: pl.score }))
        .sort((x, y) => y.score - x.score);
    }
    send(p.ws, base);
  }
}

function clearTimer(room) {
  if (room.timerHandle) { clearInterval(room.timerHandle); room.timerHandle = null; }
}

function startTimer(room, seconds, onDone) {
  clearTimer(room);
  room.timer = seconds;
  room.timerHandle = setInterval(() => {
    room.timer--;
    if (room.timer <= 0) {
      clearTimer(room);
      onDone();
    } else {
      broadcast(room);
    }
  }, 1000);
}

function pickQuestion(room) {
  const inCat = (i) => room.category === 'mixed' || QUESTIONS[i].cat === room.category;
  let pool = QUESTIONS.map((_, i) => i).filter(i => inCat(i) && !room.usedQuestions.includes(i));
  if (!pool.length) { // exhausted this category — recycle
    room.usedQuestions = [];
    pool = QUESTIONS.map((_, i) => i).filter(inCat);
  }
  const idx = pool[Math.floor(Math.random() * pool.length)];
  room.usedQuestions.push(idx);
  return QUESTIONS[idx];
}

function beginRound(room) {
  room.round++;
  room.phase = 'writing';
  room.question = pickQuestion(room);
  room.answers = [];
  room.lastRoundScores = {};
  for (const p of room.players.values()) { p.lie = null; p.votedFor = null; }
  broadcast(room);
  startTimer(room, WRITE_SECONDS, () => toVoting(room));
}

function toVoting(room) {
  clearTimer(room);
  room.phase = 'voting';

  // Collect lies, merging identical ones so duplicate guessers share the fool-credit.
  const byText = new Map(); // normalized -> {text, authorIds}
  for (const p of activePlayers(room)) {
    if (!p.lie) continue;
    const key = norm(p.lie);
    if (key === norm(room.question.answer)) continue; // accidentally-true lie can't compete as a lie
    if (!byText.has(key)) byText.set(key, { text: p.lie, authorIds: [] });
    byText.get(key).authorIds.push(p.id);
  }

  let aid = 1;
  const answers = [];
  const taken = new Set();
  for (const { text, authorIds } of byText.values()) {
    answers.push({ id: aid++, text, authorIds, isTruth: false, isDecoy: false, points: 0 });
    taken.add(norm(text));
  }
  // Always include the truth.
  answers.push({ id: aid++, text: room.question.answer, authorIds: [], isTruth: true, isDecoy: false, points: 0 });
  taken.add(norm(room.question.answer));

  // Seed believable house decoys: always at least MIN_DECOYS, and enough to reach
  // MIN_OPTIONS total, so even tiny groups face a tough, convincing board.
  let added = 0;
  for (const d of shuffle(room.question.decoys || [])) {
    if (added >= MIN_DECOYS && answers.length >= MIN_OPTIONS) break;
    if (taken.has(norm(d))) continue;
    answers.push({ id: aid++, text: d, authorIds: [], isTruth: false, isDecoy: true, points: 0 });
    taken.add(norm(d));
    added++;
  }

  room.answers = shuffle(answers);
  broadcast(room);
  startTimer(room, VOTE_SECONDS, () => toReveal(room));
}

function toReveal(room) {
  clearTimer(room);
  room.phase = 'reveal';
  const roundScores = {};
  for (const p of room.players.values()) roundScores[p.id] = 0;

  for (const a of room.answers) {
    const voters = [...room.players.values()].filter(v => v.votedFor === a.id);
    if (a.isTruth) {
      // Truth-finders earn TRUTH_POINTS each.
      for (const v of voters) {
        v.score += TRUTH_POINTS;
        roundScores[v.id] = (roundScores[v.id] || 0) + TRUTH_POINTS;
      }
    } else {
      // Each author earns FOOL_POINTS per voter fooled. House decoys (no authors) earn nobody points.
      const fooled = voters.length;
      a.points = a.authorIds.length ? fooled * FOOL_POINTS : 0;
      for (const authorId of a.authorIds) {
        const author = room.players.get(authorId);
        if (!author) continue;
        author.score += fooled * FOOL_POINTS;
        roundScores[authorId] = (roundScores[authorId] || 0) + fooled * FOOL_POINTS;
      }
    }
  }
  room.lastRoundScores = roundScores;
  broadcast(room);
}

function advance(room) {
  if (room.round >= room.totalRounds) {
    room.phase = 'final';
    broadcast(room);
  } else {
    beginRound(room);
  }
}

// Auto-advance helpers when everyone has acted.
function maybeAllWritten(room) {
  const act = activePlayers(room);
  if (act.length && act.every(p => p.lie != null)) toVoting(room);
}
function maybeAllVoted(room) {
  const act = activePlayers(room);
  if (act.length && act.every(p => p.votedFor != null)) toReveal(room);
}

function reassignHostIfNeeded(room) {
  if (room.players.get(room.hostId)?.connected) return;
  const next = activePlayers(room)[0];
  room.hostId = next ? next.id : null;
}

// ── Networking ─────────────────────────────────────────────────────────
function getLocalIPs() {
  const ips = [];
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal) ips.push(iface.address);
    }
  }
  return ips;
}

const server = http.createServer((req, res) => {
  if (req.url === '/info') {
    const ips = getLocalIPs();
    const url = `http://${ips[0] || 'localhost'}:${PORT}/`;
    if (QRCode && !server._qrCache) {
      QRCode.toDataURL(url, { width: 220, margin: 2 }, (err, dataUrl) => {
        server._qrCache = err ? null : dataUrl;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ips, port: PORT, qr: server._qrCache }));
      });
    } else {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ips, port: PORT, qr: server._qrCache || null }));
    }
    return;
  }
  if (req.url === '/' || req.url === '/index.html') {
    fs.readFile(path.join(__dirname, 'fib-factory.html'), (err, data) => {
      if (err) { res.writeHead(404); res.end('client not found'); return; }
      res.writeHead(200, {
        'content-type': 'text/html',
        'cache-control': 'no-cache, no-store, must-revalidate',
      });
      res.end(data);
    });
    return;
  }
  res.writeHead(404); res.end('not found');
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  ws.roomCode = null;
  ws.playerId = null;

  ws.on('message', (buf) => {
    let msg;
    try { msg = JSON.parse(buf); } catch { return; }
    handle(ws, msg);
  });

  ws.on('close', () => {
    const room = rooms.get(ws.roomCode);
    if (!room) return;
    const p = room.players.get(ws.playerId);
    if (p) { p.connected = false; p.ws = null; }
    reassignHostIfNeeded(room);
    // If a disconnect means everyone left has acted, keep the game flowing.
    if (room.phase === 'writing') maybeAllWritten(room);
    else if (room.phase === 'voting') maybeAllVoted(room);
    if (activePlayers(room).length === 0) {
      clearTimer(room);
      rooms.delete(room.code);
    } else {
      broadcast(room);
    }
  });
});

function handle(ws, msg) {
  switch (msg.t) {
    case 'create': {
      const room = makeRoom();
      const id = room.nextId++;
      const player = { id, name: cleanName(msg.name), ws, score: 0, connected: true, lie: null, votedFor: null };
      room.players.set(id, player);
      room.hostId = id;
      ws.roomCode = room.code; ws.playerId = id;
      send(ws, { t: 'joined', id, code: room.code });
      broadcast(room);
      break;
    }
    case 'join': {
      const room = rooms.get(String(msg.code || '').toUpperCase());
      if (!room) { send(ws, { t: 'error', msg: 'No room with that code.' }); return; }
      if (room.phase !== 'lobby') { send(ws, { t: 'error', msg: 'That game already started.' }); return; }
      if (activePlayers(room).length >= 12) { send(ws, { t: 'error', msg: 'Room is full (12 max).' }); return; }
      const id = room.nextId++;
      const player = { id, name: cleanName(msg.name), ws, score: 0, connected: true, lie: null, votedFor: null };
      room.players.set(id, player);
      ws.roomCode = room.code; ws.playerId = id;
      send(ws, { t: 'joined', id, code: room.code });
      broadcast(room);
      break;
    }
    case 'setRounds': {
      const room = rooms.get(ws.roomCode);
      if (!room || ws.playerId !== room.hostId || room.phase !== 'lobby') return;
      const n = Math.max(1, Math.min(20, parseInt(msg.rounds, 10) || ROUNDS_DEFAULT));
      room.totalRounds = n;
      broadcast(room);
      break;
    }
    case 'setCategory': {
      const room = rooms.get(ws.roomCode);
      if (!room || ws.playerId !== room.hostId || room.phase !== 'lobby') return;
      if (CATEGORY_KEYS.includes(msg.category)) room.category = msg.category;
      broadcast(room);
      break;
    }
    case 'start': {
      const room = rooms.get(ws.roomCode);
      if (!room || ws.playerId !== room.hostId) return;
      if (room.phase !== 'lobby') return;
      if (activePlayers(room).length < 2) { send(ws, { t: 'error', msg: 'Need at least 2 players.' }); return; }
      room.round = 0;
      room.usedQuestions = [];
      for (const p of room.players.values()) p.score = 0;
      beginRound(room);
      break;
    }
    case 'lie': {
      const room = rooms.get(ws.roomCode);
      if (!room || room.phase !== 'writing') return;
      const p = room.players.get(ws.playerId);
      if (!p) return;
      const text = String(msg.text || '').trim().slice(0, 80);
      if (!text) return;
      if (norm(text) === norm(room.question.answer)) {
        send(ws, { t: 'oops', msg: "That's actually the TRUTH! Write a believable lie instead." });
        return;
      }
      p.lie = text;
      broadcast(room);
      maybeAllWritten(room);
      break;
    }
    case 'vote': {
      const room = rooms.get(ws.roomCode);
      if (!room || room.phase !== 'voting') return;
      const p = room.players.get(ws.playerId);
      if (!p) return;
      const ans = room.answers.find(a => a.id === msg.answerId);
      if (!ans) return;
      if (ans.authorIds.includes(p.id)) { send(ws, { t: 'oops', msg: "You can't vote for your own lie!" }); return; }
      p.votedFor = msg.answerId;
      broadcast(room);
      maybeAllVoted(room);
      break;
    }
    case 'next': {
      const room = rooms.get(ws.roomCode);
      if (!room || ws.playerId !== room.hostId || room.phase !== 'reveal') return;
      advance(room);
      break;
    }
    case 'again': {
      const room = rooms.get(ws.roomCode);
      if (!room || ws.playerId !== room.hostId || room.phase !== 'final') return;
      room.phase = 'lobby';
      room.round = 0;
      room.usedQuestions = [];
      for (const p of room.players.values()) { p.score = 0; p.lie = null; p.votedFor = null; }
      broadcast(room);
      break;
    }
  }
}

function cleanName(n) {
  const s = String(n || '').trim().slice(0, 16);
  return s || 'Player';
}

server.listen(PORT, () => {
  const ips = getLocalIPs();
  console.log('\n🏭  Fib Factory server running!');
  console.log(`    Local:   http://localhost:${PORT}/`);
  for (const ip of ips) console.log(`    Network: http://${ip}:${PORT}/`);
  console.log(`    ${QUESTIONS.length} questions across ${CATEGORY_KEYS.length - 1} categories.`);
  console.log('\n    Share the public tunnel URL with friends to play.\n');
});
