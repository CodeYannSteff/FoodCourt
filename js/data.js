/**
 * Muncho — Argeș Mall Food Court Multi-Venue Data Adapter
 * Centralizes restaurants and menus inside Argeș Mall (Pitești).
 */

const VENUES = [
  {
    id: 'sapori',
    name: 'Pizzeria Sapori Italia',
    cat: 'Pizza pe vatră · Paste · Crispy',
    eta: '20-30',
    rating: '4.9',
    reviews: '280+',
    openNow: true,
    tag: 'Partener Oficial',
    directApi: true,
    phone: '0770 864 679',
    about: 'Pizzerie artizanală de familie — pizza pe vatră cu maia, paste autentice și preparate gătite pe loc.',
    hero: (typeof MENU !== 'undefined' && MENU.hero) ? MENU.hero : 'assets/img/p7385.jpg',
    logo: (typeof MENU !== 'undefined' && MENU.items && MENU.items[0]) ? MENU.items[0].img : 'assets/img/p7385.jpg'
  },
  {
    id: 'burger',
    name: 'Burger & Grill Corner',
    cat: 'Smash Burgeri · Loaded Fries',
    eta: '15-20',
    rating: '4.8',
    reviews: '190+',
    openNow: true,
    tag: 'Popular',
    directApi: false,
    about: 'Burgeri suculenți din carne de vită Black Angus, cartofi prăjiți crocanți și sosuri preparate în casă.',
    hero: 'https://images.unsplash.com/photo-1550547660-d9450f859349?w=800&q=80',
    logo: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=400&q=80'
  },
  {
    id: 'wok',
    name: 'Noodle & Wok Station',
    cat: 'Asian Wok · Teriyaki · Dim Sum',
    eta: '15-20',
    rating: '4.7',
    reviews: '145+',
    openNow: true,
    tag: 'Rapid',
    directApi: false,
    about: 'Noodles fierbinți la wok cu sos teriyaki dulce-picant, carne marinată și legume proaspete rumenite rapid.',
    hero: 'https://images.unsplash.com/photo-1585032226651-759b368d7246?w=800&q=80',
    logo: 'https://images.unsplash.com/photo-1541696432-82c6da8ce7bf?w=400&q=80'
  },
  {
    id: 'sweet',
    name: 'Sweet Delights & Gelato',
    cat: 'Clătite · Waffle · Gelato',
    eta: '5-10',
    rating: '4.9',
    reviews: '210+',
    openNow: true,
    tag: 'Desert',
    directApi: false,
    about: 'Clătite uriașe franțuzești, waffle belgiene calde cu ciocolată fină și înghețată artizanală cremoasă.',
    hero: 'https://images.unsplash.com/photo-1551024709-8f23befc6f87?w=800&q=80',
    logo: 'https://images.unsplash.com/photo-1563805042-7684c019e1cb?w=400&q=80'
  }
];

// Additional signature items for other food court restaurants
const EXTRA_ITEMS = [
  // Burger & Grill Corner
  {
    id: 'bg-1',
    venue: 'burger',
    venueName: 'Burger & Grill Corner',
    cat: 'Burgeri',
    title: 'Smash Cheeseburger Bacon',
    desc: 'Chiflă brioche rumenită cu unt, 2x chiftele Black Angus smash, cheddar topit, bacon crocant, sos secret.',
    price: 38.00,
    eta: '15-20',
    badge: 'Best Seller',
    img: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=600&q=80'
  },
  {
    id: 'bg-2',
    venue: 'burger',
    venueName: 'Burger & Grill Corner',
    cat: 'Burgeri',
    title: 'Truffle & Mushroom Burger',
    desc: 'Carne vită Angus, cremă fină de trufe negre, ciuperci sotate în unt, rucola și brânză fontina.',
    price: 44.00,
    eta: '15-20',
    badge: 'Gourmet',
    img: 'https://images.unsplash.com/photo-1586190848861-99aa4a171e90?w=600&q=80'
  },
  {
    id: 'bg-3',
    venue: 'burger',
    venueName: 'Burger & Grill Corner',
    cat: 'Garnituri',
    title: 'Loaded Cheddar & Bacon Fries',
    desc: 'Cartofi aurii crocanți stropiți generos cu sos cald de brânză cheddar și bucățele rumene de bacon.',
    price: 22.00,
    eta: '10-15',
    img: 'https://images.unsplash.com/photo-1576107232684-1279f3908594?w=600&q=80'
  },
  // Noodle & Wok Station
  {
    id: 'wk-1',
    venue: 'wok',
    venueName: 'Noodle & Wok Station',
    cat: 'Noodles & Wok',
    title: 'Wok Noodles Teriyaki Crispy Chicken',
    desc: 'Fidea proaspătă la wok încins cu pui crocant marinat, sos teriyaki autentic, ceapă verde și semințe de susan.',
    price: 36.00,
    eta: '15-20',
    badge: 'Top Asian',
    img: 'https://images.unsplash.com/photo-1585032226651-759b368d7246?w=600&q=80'
  },
  {
    id: 'wk-2',
    venue: 'wok',
    venueName: 'Noodle & Wok Station',
    cat: 'Aperitive',
    title: 'Pachețele de Primăvară cu Legume',
    desc: 'Pachețele crocante asiatice rulate manual, servite fierbinți cu sos dulce-acrișor picant.',
    price: 18.00,
    eta: '10-15',
    img: 'https://images.unsplash.com/photo-1544025162-d76694265947?w=600&q=80'
  },
  // Sweet Delights & Gelato
  {
    id: 'sw-1',
    venue: 'sweet',
    venueName: 'Sweet Delights & Gelato',
    cat: 'Clătite & Desert',
    title: 'Clătită Mare Nutella, Căpșuni & Banane',
    desc: 'Clătită franțuzească subțire și fragedă, umplută din plin cu cremă fină de alune Nutella și felii proaspete de fructe.',
    price: 24.00,
    eta: '5-10',
    badge: 'Favorit',
    img: 'https://images.unsplash.com/photo-1519676867240-f03562e64548?w=600&q=80'
  },
  {
    id: 'sw-2',
    venue: 'sweet',
    venueName: 'Sweet Delights & Gelato',
    cat: 'Waffle & Gelato',
    title: 'Belgian Bubble Waffle cu Gelato',
    desc: 'Waffă caldă proaspăt coaptă pe plită, servită cu o cupă generoasă de gelato vanilie bourbon și sos de ciocolată.',
    price: 28.00,
    eta: '5-10',
    img: 'https://images.unsplash.com/photo-1562376552-0d160a2f238d?w=600&q=80'
  }
];

// Combine Sapori's live items with the other restaurants
const SAPORI_ITEMS = (typeof MENU !== 'undefined' && MENU.items)
  ? MENU.items.map(it => ({
      ...it,
      venue: 'sapori',
      venueName: 'Pizzeria Sapori Italia'
    }))
  : [];

const ITEMS = [...SAPORI_ITEMS, ...EXTRA_ITEMS];

const VIMG = (venueId = 'sapori') => {
  const v = VENUES.find(x => x.id === venueId);
  return (v && v.hero) ? v.hero : ((typeof MENU !== 'undefined' && MENU.hero) ? MENU.hero : '');
};

const SECTIONS = {
  sapori: (typeof MENU !== 'undefined' && MENU.sections) ? MENU.sections : ['Pizza 40cm', 'Paste', 'Crispy & Burger', 'Sandwichuri', 'Racoritoare'],
  burger: ['Burgeri', 'Garnituri'],
  wok: ['Noodles & Wok', 'Aperitive'],
  sweet: ['Clătite & Desert', 'Waffle & Gelato']
};

const FILTERS = ['All', 'Pizza 40cm', 'Paste', 'Crispy & Burger', 'Burgeri', 'Noodles & Wok', 'Clătite & Desert', 'Racoritoare'];

const venueOf = (id) => VENUES.find(v => v.id === id) || VENUES[0];
const itemOf = (id) => ITEMS.find(i => String(i.id) === String(id));
const itemsOfVenue = (venueId) => ITEMS.filter(i => i.venue === venueId);
const money = (n) => Number(n).toFixed(2) + ' lei';
