/**
 * @module
 * The default category catalog and the onboarding questions that select from it.
 *
 * The catalog is inert data: nothing is created until a user asks, and what
 * gets created is the subset matching the "situations" that apply to them.
 * Seeding every entry into every account would make category pickers unusable
 * and budgets full of empty lines.
 *
 * `always` is the base set: roughly three children per parent, chosen to be
 * true of almost anyone. Every other entry hangs off a question in
 * {@link SITUATION_GROUPS}. The invariant to keep in both directions is that no
 * entry is unreachable (an entry no question can select can never be created)
 * and no question adds nothing.
 *
 * The questions deliberately split things a coarse version would lump
 * together. "Homeowner" as one answer would cover property taxes and lawn care;
 * someone in a condo who mows nothing wants the first and not the second. The
 * same goes for a car owned outright versus one with a payment, and a toddler
 * versus a teenager.
 *
 * Slugs are the stable identity of an entry (names may be edited by users) and
 * are lowercase, unique across the catalog.
 */

/** A circumstance that makes a branch of the catalog relevant. */
export const SITUATIONS = [
  'always',
  'homeowner',
  'hoa',
  'home-services',
  'saving-for-home',
  'vehicle',
  'car-loan',
  'transit',
  'kids-young',
  'kids-school',
  'pets',
  'support-paid',
  'support-received',
  'dental-vision',
  'mental-health',
  'wellness',
  'extra-insurance',
  'hsa',
  'self-employed',
  'investing',
  'debt',
  'professional-services',
  'detailed-meals',
  'detailed-home-goods',
  'going-out',
  'media',
  'tech',
  'frequent-travel',
  'religious-giving',
  'community-giving',
  'gift-occasions',
] as const
/** A situation id: one of {@link SITUATIONS}. */
export type Situation = (typeof SITUATIONS)[number]

/**
 * Type guard for situation ids, for validating untrusted input.
 *
 * @param value - Candidate string.
 * @returns True if `value` is one of {@link SITUATIONS}.
 */
export function isSituation(value: string): value is Situation {
  return (SITUATIONS as readonly string[]).includes(value)
}

/** One yes/no question in the onboarding wizard, mapped to a situation. */
export interface SituationQuestion {
  /** The situation that answering yes turns on. */
  readonly situation: Situation
  /** Phrased as something the user says about themselves, not as a category name. */
  readonly label: string
  /** What answering yes actually adds. Null when the label already says it. */
  readonly hint: string | null
}

/** A titled section of related wizard questions. */
export interface SituationGroup {
  /** Stable identifier for the group. */
  readonly key: string
  /** Section heading shown to the user. */
  readonly title: string
  /** Optional explanatory line under the heading. */
  readonly hint: string | null
  /** Questions in display order. */
  readonly questions: readonly SituationQuestion[]
}

/**
 * The onboarding wizard, as data.
 *
 * Kept alongside the catalog so there is one list: a question with no catalog
 * entry tagged with its situation would create nothing, and a situation
 * tagged on entries but never asked would be dead weight.
 */
export const SITUATION_GROUPS: readonly SituationGroup[] = [
  {
    key: 'home',
    title: 'Your home',
    hint: 'Renting is covered by the basics — these are the costs that come with owning or maintaining a place.',
    questions: [
      { situation: 'homeowner', label: 'I own my home', hint: 'Property taxes, insurance, repairs, water and refuse' },
      { situation: 'hoa', label: 'I pay HOA or condo fees', hint: 'A single line for the monthly association bill' },
      { situation: 'home-services', label: 'I pay for cleaning, lawn care or pest control', hint: 'Recurring services someone else performs' },
      { situation: 'saving-for-home', label: 'I\'m saving for a down payment', hint: 'A savings bucket separate from the emergency fund' },
    ],
  },
  {
    key: 'getting-around',
    title: 'Getting around',
    hint: null,
    questions: [
      { situation: 'vehicle', label: 'I own or lease a vehicle', hint: 'Fuel, insurance, maintenance, registration, tolls' },
      { situation: 'car-loan', label: 'I have a car payment or lease payment', hint: 'Kept separate so an owned-outright car has no empty line' },
      { situation: 'transit', label: 'I use public transit', hint: 'Passes and fares, apart from ride sharing' },
    ],
  },
  {
    key: 'household',
    title: 'Who else is in the picture',
    hint: null,
    questions: [
      { situation: 'kids-young', label: 'I have children under school age', hint: 'Daycare, babysitting, baby supplies' },
      { situation: 'kids-school', label: 'I have school-age children', hint: 'Tuition, activities, supplies, camp, lessons, allowance' },
      { situation: 'pets', label: 'I have pets', hint: 'Vet, food, medication, grooming, insurance' },
      { situation: 'support-paid', label: 'I pay child support or alimony', hint: null },
      { situation: 'support-received', label: 'I receive support, alimony or regular gifts', hint: 'Income that is not a paycheck' },
    ],
  },
  {
    key: 'health',
    title: 'Health and protection',
    hint: 'Health insurance, prescriptions and doctor visits are already in the basics.',
    questions: [
      { situation: 'dental-vision', label: 'I have dental or vision coverage', hint: 'Premiums and visits, separated from general medical' },
      { situation: 'mental-health', label: 'I pay for therapy or counseling', hint: null },
      { situation: 'wellness', label: 'I spend on fitness, beauty or supplements', hint: 'Cosmetics, spa, nails, athletic wear, vitamins' },
      { situation: 'extra-insurance', label: 'I carry disability, umbrella or identity protection', hint: null },
      { situation: 'hsa', label: 'I contribute to an HSA', hint: null },
    ],
  },
  {
    key: 'work-money',
    title: 'Work and money',
    hint: null,
    questions: [
      { situation: 'self-employed', label: 'I\'m self-employed or have side income', hint: 'Business income, tips, memberships, conferences, consultants' },
      { situation: 'investing', label: 'I invest or own rental property', hint: 'Dividends, interest, rent, brokerage, financial advisor' },
      { situation: 'debt', label: 'I\'m paying down debt', hint: 'Credit cards, student loans, medical debt, back taxes' },
      { situation: 'professional-services', label: 'I pay for legal, coaching or consulting help', hint: null },
    ],
  },
  {
    key: 'day-to-day',
    title: 'How closely do you want to track',
    hint: 'Optional detail. Each one splits a category the basics already cover into finer lines — useful if you want the breakdown, noise if you do not.',
    questions: [
      { situation: 'detailed-meals', label: 'Split meals out by kind', hint: 'Breakfast, lunch, dinner, drinks, snacks — beyond groceries and takeout' },
      { situation: 'detailed-home-goods', label: 'Split household goods out', hint: 'Paper products and home decor, beyond cleaning supplies' },
      { situation: 'going-out', label: 'I go to concerts and sporting events', hint: null },
      { situation: 'media', label: 'I subscribe to news, magazines or audiobooks', hint: null },
      { situation: 'tech', label: 'I spend on smart home, networking, gaming or web hosting', hint: 'Smart home, home networking, gaming gear, domains and hosting' },
      { situation: 'frequent-travel', label: 'I travel often', hint: 'Car rental, baggage fees and a vacation savings bucket' },
      { situation: 'religious-giving', label: 'I tithe or give to a religious organization', hint: null },
      { situation: 'community-giving', label: 'I give to community or political causes', hint: null },
      { situation: 'gift-occasions', label: 'I buy gifts for weddings, showers and occasions', hint: 'Beyond birthdays and holidays' },
    ],
  },
]

/** What a category means for cash flow. */
export type CatalogKind = 'expense' | 'income' | 'transfer'

/** One category in the default catalog. */
export interface CatalogEntry {
  /** Lowercase unique identifier; also the join key with a user's existing categories. */
  readonly slug: string
  /** Display name. */
  readonly name: string
  /** Icon identifier, or null for none. */
  readonly icon: string | null
  /** Ordering among siblings (ascending). */
  readonly sortOrder: number
  /** Slug of the parent, or null for a top-level category. */
  readonly parent: string | null
  /** Every situation that reaches this entry. Never empty. */
  readonly situations: readonly Situation[]
  /**
   * What the entry means for cash flow. Omitted means `expense`, which is what
   * the overwhelming majority of a spending taxonomy is.
   */
  readonly kind?: CatalogKind
}

/** The full catalog, parents interleaved with their children, parents always listed before their own children. */
export const CATEGORY_CATALOG: readonly CatalogEntry[] = [
  { slug: 'income', name: 'Income', icon: 'TrendingUp', sortOrder: 10, parent: null, situations: ['always'], kind: 'income' },
  { slug: 'salary', name: 'Salary', icon: 'Briefcase', sortOrder: 10, parent: 'income', situations: ['always'], kind: 'income' },
  { slug: 'self-employed-income', name: 'Self-employed income', icon: 'Laptop', sortOrder: 20, parent: 'income', situations: ['self-employed'], kind: 'income' },
  { slug: 'bonus', name: 'Bonus', icon: 'Award', sortOrder: 30, parent: 'income', situations: ['always'], kind: 'income' },
  { slug: 'tips', name: 'Tips', icon: 'HandCoins', sortOrder: 40, parent: 'income', situations: ['self-employed'], kind: 'income' },
  { slug: 'tax-refund', name: 'Tax refund', icon: 'Receipt', sortOrder: 50, parent: 'income', situations: ['always'], kind: 'income' },
  { slug: 'gifts-received', name: 'Gifts received', icon: 'Gift', sortOrder: 60, parent: 'income', situations: ['support-received'], kind: 'income' },
  { slug: 'alimony-received', name: 'Alimony received', icon: 'Scale', sortOrder: 70, parent: 'income', situations: ['support-received'], kind: 'income' },
  { slug: 'child-support-received', name: 'Child support received', icon: 'Scale', sortOrder: 80, parent: 'income', situations: ['support-received'], kind: 'income' },
  { slug: 'rental-income', name: 'Rental income', icon: 'Home', sortOrder: 90, parent: 'income', situations: ['investing'], kind: 'income' },
  { slug: 'dividend-income', name: 'Dividend income', icon: 'BarChart2', sortOrder: 100, parent: 'income', situations: ['investing'], kind: 'income' },
  { slug: 'interest-earned', name: 'Interest earned', icon: 'Percent', sortOrder: 110, parent: 'income', situations: ['investing'], kind: 'income' },
  { slug: 'deposit', name: 'Deposit', icon: 'ArrowDownToLine', sortOrder: 120, parent: 'income', situations: ['always'], kind: 'income' },
  { slug: 'refund', name: 'Refund', icon: 'Undo2', sortOrder: 130, parent: 'income', situations: ['always'], kind: 'income' },
  { slug: 'housing', name: 'Housing', icon: 'Home', sortOrder: 20, parent: null, situations: ['always'] },
  { slug: 'mortgage-rent', name: 'Mortgage / rent', icon: 'Building', sortOrder: 10, parent: 'housing', situations: ['always'] },
  { slug: 'hoa-fees', name: 'HOA fees', icon: 'Building2', sortOrder: 20, parent: 'housing', situations: ['hoa'] },
  { slug: 'homeowners-insurance', name: 'Homeowners insurance', icon: 'Shield', sortOrder: 30, parent: 'housing', situations: ['homeowner'] },
  { slug: 'property-insurance', name: 'Property insurance', icon: 'ShieldCheck', sortOrder: 40, parent: 'housing', situations: ['homeowner'] },
  { slug: 'home-repairs-maintenance', name: 'Home repairs / maintenance', icon: 'Wrench', sortOrder: 50, parent: 'housing', situations: ['homeowner'] },
  { slug: 'property-taxes', name: 'Property taxes', icon: 'Landmark', sortOrder: 60, parent: 'housing', situations: ['homeowner'] },
  { slug: 'home-improvement', name: 'Home improvement', icon: 'Hammer', sortOrder: 70, parent: 'housing', situations: ['homeowner'] },
  { slug: 'home-services', name: 'Home services', icon: 'Sparkles', sortOrder: 30, parent: null, situations: ['home-services'] },
  { slug: 'house-cleaning', name: 'House cleaning', icon: 'Sparkles', sortOrder: 10, parent: 'home-services', situations: ['home-services'] },
  { slug: 'lawn-care', name: 'Lawn care', icon: 'TreePine', sortOrder: 20, parent: 'home-services', situations: ['home-services'] },
  { slug: 'security-system', name: 'Security system', icon: 'Shield', sortOrder: 30, parent: 'home-services', situations: ['home-services'] },
  { slug: 'pest-control', name: 'Pest control', icon: 'Bug', sortOrder: 40, parent: 'home-services', situations: ['home-services'] },
  { slug: 'utilities', name: 'Utilities', icon: 'Zap', sortOrder: 40, parent: null, situations: ['always'] },
  { slug: 'natural-gas', name: 'Natural gas', icon: 'Flame', sortOrder: 10, parent: 'utilities', situations: ['always'] },
  { slug: 'electricity', name: 'Electricity', icon: 'Zap', sortOrder: 20, parent: 'utilities', situations: ['always'] },
  { slug: 'mobile-phone', name: 'Mobile phone', icon: 'Smartphone', sortOrder: 30, parent: 'utilities', situations: ['always'] },
  { slug: 'home-internet', name: 'Home internet', icon: 'Wifi', sortOrder: 40, parent: 'utilities', situations: ['always'] },
  { slug: 'water', name: 'Water', icon: 'Droplets', sortOrder: 50, parent: 'utilities', situations: ['homeowner'] },
  { slug: 'sewer', name: 'Sewer', icon: 'Droplets', sortOrder: 60, parent: 'utilities', situations: ['homeowner'] },
  { slug: 'garbage-recycling', name: 'Garbage / recycling', icon: 'Trash2', sortOrder: 70, parent: 'utilities', situations: ['homeowner'] },
  { slug: 'household-items', name: 'Household items', icon: 'ShoppingCart', sortOrder: 50, parent: null, situations: ['always'] },
  { slug: 'cleaning-supplies', name: 'Cleaning supplies', icon: 'Sparkles', sortOrder: 10, parent: 'household-items', situations: ['always'] },
  { slug: 'paper-products', name: 'Paper products', icon: 'Package', sortOrder: 20, parent: 'household-items', situations: ['detailed-home-goods'] },
  { slug: 'tools', name: 'Tools', icon: 'Wrench', sortOrder: 30, parent: 'household-items', situations: ['homeowner'] },
  { slug: 'toiletries', name: 'Toiletries', icon: 'Droplets', sortOrder: 40, parent: 'household-items', situations: ['always'] },
  { slug: 'furniture', name: 'Furniture', icon: 'Sofa', sortOrder: 50, parent: 'household-items', situations: ['always'] },
  { slug: 'home-decor', name: 'Home decor', icon: 'Palette', sortOrder: 60, parent: 'household-items', situations: ['detailed-home-goods'] },
  { slug: 'food', name: 'Food', icon: 'Utensils', sortOrder: 60, parent: null, situations: ['always'] },
  { slug: 'groceries', name: 'Groceries', icon: 'ShoppingCart', sortOrder: 10, parent: 'food', situations: ['always'] },
  { slug: 'takeout', name: 'Takeout', icon: 'UtensilsCrossed', sortOrder: 20, parent: 'food', situations: ['always'] },
  { slug: 'coffee-shops', name: 'Coffee shops', icon: 'Coffee', sortOrder: 30, parent: 'food', situations: ['always'] },
  { slug: 'breakfast', name: 'Breakfast', icon: 'Egg', sortOrder: 40, parent: 'food', situations: ['detailed-meals'] },
  { slug: 'lunch', name: 'Lunch', icon: 'Sandwich', sortOrder: 50, parent: 'food', situations: ['detailed-meals'] },
  { slug: 'dinner', name: 'Dinner', icon: 'Utensils', sortOrder: 60, parent: 'food', situations: ['detailed-meals'] },
  { slug: 'drinks', name: 'Drinks', icon: 'Wine', sortOrder: 70, parent: 'food', situations: ['detailed-meals'] },
  { slug: 'snacks', name: 'Snacks', icon: 'Cookie', sortOrder: 80, parent: 'food', situations: ['detailed-meals'] },
  { slug: 'transportation', name: 'Transportation', icon: 'Car', sortOrder: 70, parent: null, situations: ['always'] },
  { slug: 'car-payment-lease', name: 'Car payment / lease', icon: 'CreditCard', sortOrder: 10, parent: 'transportation', situations: ['car-loan'] },
  { slug: 'car-insurance', name: 'Car insurance', icon: 'Shield', sortOrder: 20, parent: 'transportation', situations: ['vehicle'] },
  { slug: 'gas', name: 'Gas', icon: 'Fuel', sortOrder: 30, parent: 'transportation', situations: ['vehicle'] },
  { slug: 'oil-change-maintenance', name: 'Oil change / maintenance', icon: 'Wrench', sortOrder: 40, parent: 'transportation', situations: ['vehicle'] },
  { slug: 'registration', name: 'Registration', icon: 'FileText', sortOrder: 50, parent: 'transportation', situations: ['vehicle'] },
  { slug: 'public-transportation', name: 'Public transportation', icon: 'Bus', sortOrder: 60, parent: 'transportation', situations: ['transit'] },
  { slug: 'ride-sharing', name: 'Ride sharing', icon: 'Car', sortOrder: 70, parent: 'transportation', situations: ['always'] },
  { slug: 'tolls-parking', name: 'Tolls / parking', icon: 'ParkingCircle', sortOrder: 80, parent: 'transportation', situations: ['vehicle'] },
  { slug: 'roadside-assistance', name: 'Roadside assistance', icon: 'AlertTriangle', sortOrder: 90, parent: 'transportation', situations: ['vehicle'] },
  { slug: 'medical-health', name: 'Medical / health', icon: 'Heart', sortOrder: 80, parent: null, situations: ['always'] },
  { slug: 'health-insurance', name: 'Health insurance', icon: 'Shield', sortOrder: 10, parent: 'medical-health', situations: ['always'] },
  { slug: 'dental-insurance', name: 'Dental insurance', icon: 'Shield', sortOrder: 20, parent: 'medical-health', situations: ['dental-vision'] },
  { slug: 'vision-insurance', name: 'Vision insurance', icon: 'Shield', sortOrder: 30, parent: 'medical-health', situations: ['dental-vision'] },
  { slug: 'prescriptions', name: 'Prescriptions', icon: 'Pill', sortOrder: 40, parent: 'medical-health', situations: ['always'] },
  { slug: 'doctor-visits', name: 'Doctor visits', icon: 'Stethoscope', sortOrder: 50, parent: 'medical-health', situations: ['always'] },
  { slug: 'dental-visits', name: 'Dental visits', icon: 'Smile', sortOrder: 60, parent: 'medical-health', situations: ['dental-vision'] },
  { slug: 'vision-optometrist', name: 'Vision / optometrist', icon: 'Eye', sortOrder: 70, parent: 'medical-health', situations: ['dental-vision'] },
  { slug: 'therapy-counseling', name: 'Therapy / counseling', icon: 'HeartHandshake', sortOrder: 80, parent: 'medical-health', situations: ['mental-health'] },
  { slug: 'vitamins-supplements', name: 'Vitamins / supplements', icon: 'Pill', sortOrder: 90, parent: 'medical-health', situations: ['wellness'] },
  { slug: 'insurance', name: 'Insurance', icon: 'Shield', sortOrder: 90, parent: null, situations: ['always'] },
  { slug: 'life-insurance', name: 'Life insurance', icon: 'Shield', sortOrder: 10, parent: 'insurance', situations: ['always'] },
  { slug: 'disability-insurance', name: 'Disability insurance', icon: 'Shield', sortOrder: 20, parent: 'insurance', situations: ['extra-insurance'] },
  { slug: 'long-term-care-insurance', name: 'Long-term care insurance', icon: 'Shield', sortOrder: 30, parent: 'insurance', situations: ['extra-insurance'] },
  { slug: 'umbrella-policy', name: 'Umbrella policy', icon: 'Umbrella', sortOrder: 40, parent: 'insurance', situations: ['extra-insurance'] },
  { slug: 'identity-theft-protection', name: 'Identity theft protection', icon: 'ShieldAlert', sortOrder: 50, parent: 'insurance', situations: ['extra-insurance'] },
  { slug: 'kids', name: 'Kids', icon: 'Baby', sortOrder: 100, parent: null, situations: ['kids-young', 'kids-school'] },
  { slug: 'kids-tuition', name: 'Tuition', icon: 'GraduationCap', sortOrder: 10, parent: 'kids', situations: ['kids-school'] },
  { slug: 'daycare', name: 'Daycare', icon: 'Building', sortOrder: 20, parent: 'kids', situations: ['kids-young'] },
  { slug: 'babysitter-nanny', name: 'Babysitter / nanny', icon: 'User', sortOrder: 30, parent: 'kids', situations: ['kids-young'] },
  { slug: 'baby-supplies', name: 'Baby supplies', icon: 'Baby', sortOrder: 40, parent: 'kids', situations: ['kids-young'] },
  { slug: 'summer-camp', name: 'Summer camp', icon: 'TreePine', sortOrder: 50, parent: 'kids', situations: ['kids-school'] },
  { slug: 'school-activities', name: 'School activities', icon: 'Trophy', sortOrder: 60, parent: 'kids', situations: ['kids-school'] },
  { slug: 'school-supplies', name: 'School supplies', icon: 'BookOpen', sortOrder: 70, parent: 'kids', situations: ['kids-school'] },
  { slug: 'lessons', name: 'Lessons', icon: 'Music', sortOrder: 80, parent: 'kids', situations: ['kids-school'] },
  { slug: 'allowance', name: 'Allowance', icon: 'Coins', sortOrder: 90, parent: 'kids', situations: ['kids-school'] },
  { slug: 'kids-clothing', name: 'Kids clothing', icon: 'Shirt', sortOrder: 100, parent: 'kids', situations: ['kids-young', 'kids-school'] },
  { slug: 'child-support', name: 'Child support', icon: 'Scale', sortOrder: 110, parent: 'kids', situations: ['support-paid'] },
  { slug: 'pets', name: 'Pets', icon: 'PawPrint', sortOrder: 110, parent: null, situations: ['pets'] },
  { slug: 'veterinarian', name: 'Veterinarian', icon: 'Stethoscope', sortOrder: 10, parent: 'pets', situations: ['pets'] },
  { slug: 'pet-food', name: 'Pet food', icon: 'UtensilsCrossed', sortOrder: 20, parent: 'pets', situations: ['pets'] },
  { slug: 'pet-medication', name: 'Pet medication', icon: 'Pill', sortOrder: 30, parent: 'pets', situations: ['pets'] },
  { slug: 'pet-grooming', name: 'Pet grooming', icon: 'Scissors', sortOrder: 40, parent: 'pets', situations: ['pets'] },
  { slug: 'pet-insurance', name: 'Pet insurance', icon: 'Shield', sortOrder: 50, parent: 'pets', situations: ['pets'] },
  { slug: 'pet-supplies', name: 'Pet supplies', icon: 'ShoppingBag', sortOrder: 60, parent: 'pets', situations: ['pets'] },
  { slug: 'subscriptions', name: 'Subscriptions', icon: 'Tv', sortOrder: 120, parent: null, situations: ['always'] },
  { slug: 'streaming-video', name: 'Streaming video', icon: 'Play', sortOrder: 10, parent: 'subscriptions', situations: ['always'] },
  { slug: 'streaming-music', name: 'Streaming music', icon: 'Music', sortOrder: 20, parent: 'subscriptions', situations: ['always'] },
  { slug: 'software-subscriptions', name: 'Software subscriptions', icon: 'Cpu', sortOrder: 30, parent: 'subscriptions', situations: ['always'] },
  { slug: 'news-magazines', name: 'News / magazines', icon: 'Newspaper', sortOrder: 40, parent: 'subscriptions', situations: ['media'] },
  { slug: 'audiobooks-podcasts', name: 'Audiobooks / podcasts', icon: 'Headphones', sortOrder: 50, parent: 'subscriptions', situations: ['media'] },
  { slug: 'professional-memberships', name: 'Professional memberships', icon: 'BadgeCheck', sortOrder: 60, parent: 'subscriptions', situations: ['self-employed'] },
  { slug: 'memberships', name: 'Memberships', icon: 'IdCard', sortOrder: 70, parent: 'subscriptions', situations: ['always'] },
  { slug: 'clothing', name: 'Clothing', icon: 'Shirt', sortOrder: 130, parent: null, situations: ['always'] },
  { slug: 'work-clothing', name: 'Work clothing', icon: 'Briefcase', sortOrder: 10, parent: 'clothing', situations: ['always'] },
  { slug: 'athletic-clothing', name: 'Athletic clothing', icon: 'Dumbbell', sortOrder: 20, parent: 'clothing', situations: ['wellness'] },
  { slug: 'casual-clothing', name: 'Casual clothing', icon: 'Shirt', sortOrder: 30, parent: 'clothing', situations: ['always'] },
  { slug: 'alterations-dry-cleaning', name: 'Alterations / dry cleaning', icon: 'Scissors', sortOrder: 40, parent: 'clothing', situations: ['always'] },
  { slug: 'personal-care', name: 'Personal care', icon: 'Sparkles', sortOrder: 140, parent: null, situations: ['always'] },
  { slug: 'haircuts-styling', name: 'Haircuts / styling', icon: 'Scissors', sortOrder: 10, parent: 'personal-care', situations: ['always'] },
  { slug: 'cosmetics', name: 'Cosmetics', icon: 'Palette', sortOrder: 20, parent: 'personal-care', situations: ['wellness'] },
  { slug: 'spa-massage', name: 'Spa / massage', icon: 'Flower2', sortOrder: 30, parent: 'personal-care', situations: ['wellness'] },
  { slug: 'gym-membership', name: 'Gym membership', icon: 'Dumbbell', sortOrder: 40, parent: 'personal-care', situations: ['always'] },
  { slug: 'nail-salon', name: 'Nail salon', icon: 'Sparkles', sortOrder: 50, parent: 'personal-care', situations: ['wellness'] },
  { slug: 'personal-development', name: 'Personal development', icon: 'BookOpen', sortOrder: 150, parent: null, situations: ['always'] },
  { slug: 'books', name: 'Books', icon: 'BookOpen', sortOrder: 10, parent: 'personal-development', situations: ['always'] },
  { slug: 'online-courses', name: 'Online courses', icon: 'Monitor', sortOrder: 20, parent: 'personal-development', situations: ['always'] },
  { slug: 'conferences', name: 'Conferences', icon: 'Users', sortOrder: 30, parent: 'personal-development', situations: ['self-employed'] },
  { slug: 'coaching', name: 'Coaching', icon: 'Target', sortOrder: 40, parent: 'personal-development', situations: ['professional-services'] },
  { slug: 'professional-fees', name: 'Professional fees', icon: 'Briefcase', sortOrder: 160, parent: null, situations: ['always'] },
  { slug: 'financial-advisor', name: 'Financial advisor', icon: 'LineChart', sortOrder: 10, parent: 'professional-fees', situations: ['investing'] },
  { slug: 'legal-attorney', name: 'Legal / attorney', icon: 'Scale', sortOrder: 20, parent: 'professional-fees', situations: ['professional-services'] },
  { slug: 'tax-professional', name: 'Tax professional', icon: 'Calculator', sortOrder: 30, parent: 'professional-fees', situations: ['always'] },
  { slug: 'business-consultant', name: 'Business consultant', icon: 'Briefcase', sortOrder: 40, parent: 'professional-fees', situations: ['self-employed', 'professional-services'] },
  { slug: 'recreation', name: 'Recreation', icon: 'Gamepad2', sortOrder: 170, parent: null, situations: ['always'] },
  { slug: 'movies-events', name: 'Movies / events', icon: 'Clapperboard', sortOrder: 10, parent: 'recreation', situations: ['always'] },
  { slug: 'concerts', name: 'Concerts', icon: 'Music', sortOrder: 20, parent: 'recreation', situations: ['going-out'] },
  { slug: 'hobbies-crafts', name: 'Hobbies / crafts', icon: 'Palette', sortOrder: 30, parent: 'recreation', situations: ['always'] },
  { slug: 'sporting-events', name: 'Sporting events', icon: 'Trophy', sortOrder: 40, parent: 'recreation', situations: ['going-out'] },
  { slug: 'entertainment', name: 'Entertainment', icon: 'Tv', sortOrder: 50, parent: 'recreation', situations: ['going-out'] },
  { slug: 'travel', name: 'Travel', icon: 'Plane', sortOrder: 180, parent: null, situations: ['always'] },
  { slug: 'vacation', name: 'Vacation', icon: 'Palmtree', sortOrder: 10, parent: 'travel', situations: ['always'] },
  { slug: 'family-trips', name: 'Family trips', icon: 'Users', sortOrder: 20, parent: 'travel', situations: ['kids-young', 'kids-school'] },
  { slug: 'hotels-lodging', name: 'Hotels / lodging', icon: 'BedDouble', sortOrder: 30, parent: 'travel', situations: ['always'] },
  { slug: 'flights', name: 'Flights', icon: 'Plane', sortOrder: 40, parent: 'travel', situations: ['always'] },
  { slug: 'car-rental', name: 'Car rental', icon: 'Car', sortOrder: 50, parent: 'travel', situations: ['frequent-travel'] },
  { slug: 'baggage-fees', name: 'Baggage fees', icon: 'Luggage', sortOrder: 60, parent: 'travel', situations: ['frequent-travel'] },
  { slug: 'technology', name: 'Technology', icon: 'Cpu', sortOrder: 190, parent: null, situations: ['always'] },
  { slug: 'computers-accessories', name: 'Computers / accessories', icon: 'Laptop', sortOrder: 10, parent: 'technology', situations: ['always'] },
  { slug: 'smart-home', name: 'Smart home', icon: 'Home', sortOrder: 20, parent: 'technology', situations: ['tech'] },
  { slug: 'gaming', name: 'Gaming', icon: 'Gamepad2', sortOrder: 30, parent: 'technology', situations: ['tech'] },
  { slug: 'home-networking', name: 'Home networking', icon: 'Wifi', sortOrder: 40, parent: 'technology', situations: ['tech'] },
  { slug: 'domains-web-hosting', name: 'Domains / web hosting', icon: 'Globe', sortOrder: 50, parent: 'technology', situations: ['tech'] },
  { slug: 'gifts', name: 'Gifts', icon: 'Gift', sortOrder: 200, parent: null, situations: ['always'] },
  { slug: 'birthday-gifts', name: 'Birthday gifts', icon: 'Cake', sortOrder: 10, parent: 'gifts', situations: ['always'] },
  { slug: 'wedding-shower-gifts', name: 'Wedding / shower gifts', icon: 'Heart', sortOrder: 20, parent: 'gifts', situations: ['gift-occasions'] },
  { slug: 'holiday-gifts', name: 'Holiday gifts', icon: 'Gift', sortOrder: 30, parent: 'gifts', situations: ['always'] },
  { slug: 'thank-you-gifts', name: 'Thank you gifts', icon: 'Gift', sortOrder: 40, parent: 'gifts', situations: ['gift-occasions'] },
  { slug: 'special-occasions', name: 'Special occasions', icon: 'PartyPopper', sortOrder: 50, parent: 'gifts', situations: ['gift-occasions'] },
  { slug: 'charitable-giving', name: 'Charitable giving', icon: 'HeartHandshake', sortOrder: 210, parent: null, situations: ['always'] },
  { slug: 'charity-donations', name: 'Charity donations', icon: 'Heart', sortOrder: 10, parent: 'charitable-giving', situations: ['always'] },
  { slug: 'tithing-religious', name: 'Tithing / religious', icon: 'Church', sortOrder: 20, parent: 'charitable-giving', situations: ['religious-giving'] },
  { slug: 'community', name: 'Community', icon: 'Users', sortOrder: 30, parent: 'charitable-giving', situations: ['community-giving'] },
  { slug: 'political', name: 'Political', icon: 'Flag', sortOrder: 40, parent: 'charitable-giving', situations: ['community-giving'] },
  { slug: 'savings-investing', name: 'Savings / investing', icon: 'PiggyBank', sortOrder: 220, parent: null, situations: ['always'] },
  { slug: 'retirement-savings', name: 'Retirement savings', icon: 'Landmark', sortOrder: 10, parent: 'savings-investing', situations: ['always'] },
  { slug: 'college-savings', name: 'College savings', icon: 'GraduationCap', sortOrder: 20, parent: 'savings-investing', situations: ['kids-young', 'kids-school'] },
  { slug: 'emergency-fund', name: 'Emergency fund', icon: 'ShieldAlert', sortOrder: 30, parent: 'savings-investing', situations: ['always'] },
  { slug: 'brokerage-investments', name: 'Brokerage investments', icon: 'TrendingUp', sortOrder: 40, parent: 'savings-investing', situations: ['investing'] },
  { slug: 'health-savings-account', name: 'Health savings account', icon: 'Heart', sortOrder: 50, parent: 'savings-investing', situations: ['hsa'] },
  { slug: 'down-payment-savings', name: 'Down payment savings', icon: 'Home', sortOrder: 60, parent: 'savings-investing', situations: ['saving-for-home'] },
  { slug: 'vacation-savings', name: 'Vacation savings', icon: 'Palmtree', sortOrder: 70, parent: 'savings-investing', situations: ['frequent-travel'] },
  { slug: 'debt-payments', name: 'Debt payments', icon: 'CreditCard', sortOrder: 230, parent: null, situations: ['debt', 'support-paid'] },
  { slug: 'credit-card-debt', name: 'Credit card debt', icon: 'CreditCard', sortOrder: 10, parent: 'debt-payments', situations: ['debt'] },
  { slug: 'student-loan-debt', name: 'Student loan debt', icon: 'GraduationCap', sortOrder: 20, parent: 'debt-payments', situations: ['debt'] },
  { slug: 'medical-debt', name: 'Medical debt', icon: 'Heart', sortOrder: 30, parent: 'debt-payments', situations: ['debt'] },
  { slug: 'personal-loans', name: 'Personal loans', icon: 'Banknote', sortOrder: 40, parent: 'debt-payments', situations: ['debt'] },
  { slug: 'back-taxes', name: 'Back taxes', icon: 'Receipt', sortOrder: 50, parent: 'debt-payments', situations: ['debt'] },
  { slug: 'alimony', name: 'Alimony', icon: 'Scale', sortOrder: 60, parent: 'debt-payments', situations: ['support-paid', 'debt'] },
  { slug: 'transfers', name: 'Transfers', icon: 'ArrowLeftRight', sortOrder: 240, parent: null, situations: ['always'], kind: 'transfer' },
  { slug: 'account-transfer', name: 'Between accounts', icon: 'ArrowLeftRight', sortOrder: 10, parent: 'transfers', situations: ['always'], kind: 'transfer' },
  { slug: 'credit-card-payment', name: 'Credit card payment', icon: 'CreditCard', sortOrder: 20, parent: 'transfers', situations: ['always'], kind: 'transfer' },
  { slug: 'loan-payment-principal', name: 'Loan payment (principal)', icon: 'Banknote', sortOrder: 30, parent: 'transfers', situations: ['debt'], kind: 'transfer' },
  { slug: 'banking-financial-fees', name: 'Banking & Financial Fees', icon: 'Landmark', sortOrder: 250, parent: null, situations: ['always'] },
  { slug: 'overdraft-fees', name: 'Overdraft Fees', icon: 'AlertTriangle', sortOrder: 10, parent: 'banking-financial-fees', situations: ['always'] },
  { slug: 'atm-withdrawal', name: 'ATM Withdrawal', icon: 'Banknote', sortOrder: 20, parent: 'banking-financial-fees', situations: ['always'] },
  { slug: 'check-orders', name: 'Check Orders', icon: 'FileText', sortOrder: 30, parent: 'banking-financial-fees', situations: ['always'] },
  { slug: 'office-home-administration', name: 'Office & Home Administration', icon: 'Paperclip', sortOrder: 260, parent: null, situations: ['always'] },
  { slug: 'office-supplies', name: 'Office supplies', icon: 'Paperclip', sortOrder: 10, parent: 'office-home-administration', situations: ['always'] },
  { slug: 'postage-shipping', name: 'Postage & shipping', icon: 'Mail', sortOrder: 20, parent: 'office-home-administration', situations: ['always'] },
  { slug: 'printer-ink', name: 'Printer Ink', icon: 'Printer', sortOrder: 30, parent: 'office-home-administration', situations: ['always'] },
]

/**
 * The entries matching a set of situations, parents before children.
 *
 * A parent is always included when any of its children are: a child category
 * with a dangling `parent_id` is worse than an unused parent, and the foreign
 * key would reject it anyway. Ordering matters for the same reason — the
 * caller inserts in sequence and children need their parent's id.
 *
 * @param situations - Situations that apply to the user (`always` entries
 *   are only included if `'always'` is listed).
 * @returns Matching entries with all top-level parents first, then children,
 *   each group in catalog order.
 * @example
 * selectForSituations(['always', 'pets'])
 */
export function selectForSituations(situations: readonly Situation[]): CatalogEntry[] {
  const wanted = new Set<Situation>(situations)
  const matches = (e: CatalogEntry): boolean => e.situations.some((s) => wanted.has(s))

  const children = CATEGORY_CATALOG.filter((e) => e.parent !== null && matches(e))
  const neededParents = new Set(children.map((c) => c.parent as string))

  const parents = CATEGORY_CATALOG.filter(
    (e) => e.parent === null && (matches(e) || neededParents.has(e.slug)),
  )
  const parentSlugs = new Set(parents.map((p) => p.slug))

  return [
    ...parents,
    // Drop any child whose parent did not make the cut. Cannot happen given the
    // step above, but the invariant is cheap to state and expensive to discover.
    ...children.filter((c) => parentSlugs.has(c.parent as string)),
  ]
}

/**
 * The cash-flow kind of an entry, applying the `expense` default.
 *
 * @param entry - A catalog entry.
 * @returns `entry.kind`, or `'expense'` when it is omitted.
 */
export function kindOf(entry: CatalogEntry): CatalogKind {
  return entry.kind ?? 'expense'
}

/**
 * Every situation the wizard can ask about, in the order it asks.
 *
 * @returns The situation of each question across all groups, flattened.
 */
export function askableSituations(): Situation[] {
  return SITUATION_GROUPS.flatMap((g) => g.questions.map((q) => q.situation))
}
