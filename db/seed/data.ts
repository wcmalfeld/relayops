/**
 * Fictional demonstration data for Summit Cycles (and a second tenant used to
 * demonstrate isolation). No real people, businesses or orders.
 * Times are relative to when the seed runs so the demo always looks current.
 */

export const DEMO_PASSWORD = "relayops-demo-2026";

export const SUMMIT = {
  name: "Summit Cycles",
  slug: "summit-cycles",
  timezone: "America/Denver",
  support_email: "help@summitcycles.example",
  settings: {
    public_intake_enabled: true,
    member_request_visibility: "assigned_and_unassigned",
    medium_risk_requires_approval: false,
    min_sample_for_metrics: 5,
    response_sign_off: "The Summit Cycles team",
    return_window_days: 30,
  },
};

export const HARBOR = {
  name: "Harbor Kayak Co.",
  slug: "harbor-kayak",
  timezone: "America/Los_Angeles",
  support_email: "hello@harborkayak.example",
  settings: { public_intake_enabled: false, response_sign_off: "Harbor Kayak Co.", min_sample_for_metrics: 5 },
};

export const USERS = [
  { key: "maya", email: "owner@summitcycles.example", full_name: "Maya Chen", business: "summit", role: "owner", title: "Owner" },
  { key: "jordan", email: "service@summitcycles.example", full_name: "Jordan Reyes", business: "summit", role: "member", title: "Service Lead" },
  { key: "priya", email: "frontdesk@summitcycles.example", full_name: "Priya Patel", business: "summit", role: "member", title: "Front Desk" },
  { key: "sam_okafor", email: "owner@harborkayak.example", full_name: "Sam Okafor", business: "harbor", role: "owner", title: "Owner" },
] as const;

export const CATEGORIES = [
  { key: "order_status", label: "Order status", description: "Where is my order, shipping, pickup", baseline: 7, assisted: 2 },
  { key: "product_availability", label: "Product availability", description: "Stock and size questions", baseline: 6, assisted: 2 },
  { key: "service_repair", label: "Service or repair", description: "Repairs, tune-ups, service status", baseline: 10, assisted: 4 },
  { key: "booking", label: "Booking or scheduling", description: "Service appointments", baseline: 8, assisted: 3 },
  { key: "return_refund", label: "Return or refund", description: "Returns, exchanges, refunds", baseline: 12, assisted: 5 },
  { key: "product_info", label: "Product information", description: "Specs, comparisons, recommendations", baseline: 9, assisted: 4 },
  { key: "general_question", label: "General question", description: "Hours, location, store policies", baseline: 5, assisted: 2 },
  { key: "other", label: "Other / uncertain", description: "Unclear or unrelated requests", baseline: 6, assisted: 4 },
];

export const CUSTOMERS = [
  { key: "alex", full_name: "Alex Morgan", email: "alex.morgan@example.com", phone: "(719) 555-0141", since_days: 420 },
  { key: "taylor", full_name: "Taylor Brooks", email: "taylor.brooks@example.com", phone: "(719) 555-0172", since_days: 210 },
  { key: "sam", full_name: "Sam Rivera", email: "sam.rivera@example.net", phone: "(719) 555-0188", since_days: 95 },
  { key: "jamie", full_name: "Jamie Lee", email: "jamie.lee@example.org", phone: "(719) 555-0110", since_days: 640 },
  { key: "chris", full_name: "Chris Patel", email: "chris.p@example.com", phone: null, since_days: 120 },
  { key: "dana", full_name: "Dana Whitfield", email: "dana.whitfield@example.com", phone: "(719) 555-0133", since_days: 33 },
  { key: "morgan", full_name: "Morgan Ellis", email: "morgan.ellis@example.net", phone: "(719) 555-0156", since_days: 800 },
  { key: "riley", full_name: "Riley Thompson", email: "riley.t@example.org", phone: "(719) 555-0193", since_days: 300 },
  { key: "casey", full_name: "Casey Nguyen", email: "casey.nguyen@example.com", phone: null, since_days: 14 },
  { key: "pat", full_name: "Pat Kim", email: "pat.kim@example.com", phone: null, since_days: 60 },
  // Mail to the reserved .invalid domain fails in the simulated delivery adapter.
  { key: "jblake", full_name: "Jordan Blake", email: "jordan.blake@mailbox.invalid", phone: null, since_days: 45 },
];

export const PRODUCTS = [
  { key: "rt29m", sku: "SC-RT29-M", name: "Ridgeline Trail 29 - Medium", brand: "Alder Bikes", category: "Mountain bike", price: 124900, qty: 2, reserved: 0, description: "Aluminum hardtail trail bike, 29-inch wheels, 120 mm fork, 1x12 drivetrain, hydraulic disc brakes. Medium frame fits riders roughly 5'6\"-5'10\"." },
  { key: "rt29l", sku: "SC-RT29-L", name: "Ridgeline Trail 29 - Large", brand: "Alder Bikes", category: "Mountain bike", price: 124900, qty: 0, reserved: 0, description: "Aluminum hardtail trail bike, 29-inch wheels, 120 mm fork, 1x12 drivetrain. Large frame fits riders roughly 5'10\"-6'2\"." },
  { key: "cg700m", sku: "SC-CG700-M", name: "Cascade Gravel 700 - Medium", brand: "Alder Bikes", category: "Gravel bike", price: 179900, qty: 1, reserved: 0, description: "Carbon fork gravel bike with clearance for 45 mm tires, frame bag and rack mounts for bikepacking, 2x11 drivetrain." },
  { key: "cg700l", sku: "SC-CG700-L", name: "Cascade Gravel 700 - Large", brand: "Alder Bikes", category: "Gravel bike", price: 179900, qty: 3, reserved: 1, description: "Carbon fork gravel bike with clearance for 45 mm tires, frame bag and rack mounts for bikepacking, 2x11 drivetrain." },
  { key: "mc3", sku: "SC-MC3", name: "Metro Commuter 3", brand: "Larkspur", category: "Hybrid bike", price: 64900, qty: 5, reserved: 0, description: "Upright hybrid with fenders, rear rack and integrated lights. Internal 8-speed hub." },
  { key: "et500", sku: "SC-ET500-M", name: "Summit E-Trail 500", brand: "Larkspur", category: "E-mountain bike", price: 399900, qty: 0, reserved: 0, description: "Full-suspension e-MTB with 625 Wh battery and mid-drive motor. Currently on backorder from the distributor." },
  { key: "kestrel", sku: "SC-KSL-54", name: "Kestrel Road SL", brand: "Alder Bikes", category: "Road bike", price: 249900, qty: 1, reserved: 0, description: "Carbon endurance road bike, 54 cm, electronic shifting, 32 mm tire clearance." },
  { key: "pebble", sku: "SC-PB20", name: "Pebble 20 Kids Bike", brand: "Larkspur", category: "Kids bike", price: 32900, qty: 4, reserved: 1, description: "20-inch kids bike for ages 6-9, single speed, coaster and hand brake." },
  { key: "helmet", sku: "SC-HLM-TR", name: "Trailhead MIPS Helmet", brand: "Ridgeway", category: "Accessories", price: 12900, qty: 6, reserved: 0, description: "Trail helmet with MIPS liner, adjustable visor. Sizes S, M, L." },
  { key: "sealant", sku: "SC-SEAL-8", name: "Tubeless Tire Sealant 8 oz", brand: "Ridgeway", category: "Accessories", price: 1499, qty: 30, reserved: 0, description: "Latex-based tubeless sealant, seals punctures up to 6 mm." },
  { key: "chain", sku: "SC-CHN-12", name: "12-Speed Chain", brand: "Linkwell", category: "Parts", price: 3999, qty: 12, reserved: 0, description: "12-speed chain with quick link, 126 links." },
  { key: "pads", sku: "SC-PAD-HY", name: "Hydraulic Brake Pads (pair)", brand: "Linkwell", category: "Parts", price: 2499, qty: 18, reserved: 0, description: "Resin compound pads for most two-piston hydraulic brakes." },
];

export const ORDERS = [
  { number: "SC-10421", customer: "alex", status: "shipped", fulfillment: "ship", carrier: "UPS", tracking: "1Z999AA10123456784", items: [["cg700l", 1]], placedDays: 6, expectedDays: -2, deliveredDays: null },
  { number: "SC-10433", customer: "taylor", status: "processing", fulfillment: "ship", carrier: null, tracking: null, items: [["helmet", 1], ["sealant", 2]], placedDays: 7, expectedDays: -3, deliveredDays: null },
  { number: "SC-10418", customer: "sam", status: "delivered", fulfillment: "ship", carrier: "UPS", tracking: "1Z999AA10123456791", items: [["mc3", 1]], placedDays: 15, expectedDays: null, deliveredDays: 9 },
  { number: "SC-10440", customer: "jamie", status: "ready_for_pickup", fulfillment: "pickup", carrier: null, tracking: null, items: [["pebble", 1]], placedDays: 3, expectedDays: null, deliveredDays: null },
  { number: "SC-10399", customer: "chris", status: "delivered", fulfillment: "pickup", carrier: null, tracking: null, items: [["chain", 1], ["pads", 2]], placedDays: 50, expectedDays: null, deliveredDays: 45 },
  { number: "SC-10445", customer: "dana", status: "pending", fulfillment: "ship", carrier: null, tracking: null, items: [["helmet", 1]], placedDays: 1, expectedDays: -6, deliveredDays: null },
  { number: "SC-10447", customer: "jblake", status: "shipped", fulfillment: "ship", carrier: "UPS", tracking: "1Z999AA10123456808", items: [["sealant", 1], ["chain", 1]], placedDays: 4, expectedDays: -1, deliveredDays: null },
] as const;

export const SERVICE_REQUESTS = [
  { customer: "morgan", bike: "Kestrel Road SL (54 cm)", issue: "Clicking from the drivetrain under load; chain and cassette worn.", type: "drivetrain", status: "in_progress", quoted: 18500, updatedDays: 1 },
  { customer: "riley", bike: "Summit E-Trail 500", issue: "Motor cuts out on steep climbs; waiting on replacement speed sensor.", type: "ebike_diagnostic", status: "awaiting_parts", quoted: 6500, updatedDays: 3 },
  { customer: "alex", bike: "Ridgeline Trail 29", issue: "Annual full tune-up.", type: "tune_up", status: "completed", quoted: 15900, updatedDays: 20 },
] as const;

export const POLICIES = [
  {
    key: "return_policy",
    title: "Returns and refunds",
    categories: ["return_refund"],
    body: "Unridden bikes and unused accessories can be returned within 30 days of delivery or pickup with proof of purchase, for a refund to the original payment method. Ridden bikes may qualify for store credit at a manager's discretion. Custom builds, final-sale clearance items and worn consumables (tubes, tires, chains, brake pads) are not returnable. Refunds are issued by a manager after the item is inspected in store.",
  },
  {
    key: "service_pricing",
    title: "Service pricing",
    categories: ["service_repair", "booking"],
    body: "Basic tune-up $89. Full tune-up $159. Brake bleed $45 per brake. Wheel true from $25. E-bike diagnostic $65, credited toward the repair. Parts are billed separately. Quotes are confirmed after a technician inspects the bike.",
  },
  {
    key: "service_turnaround",
    title: "Service turnaround",
    categories: ["service_repair"],
    body: "Typical turnaround is 3-5 business days after drop-off. From April through August it can be up to 10 business days. We call or email when a bike is ready or when a repair needs approval for parts.",
  },
  {
    key: "appointments",
    title: "Service appointments",
    categories: ["booking"],
    body: "Drop-off appointments are 30 minutes and include a check-in with a technician. Please arrive within 15 minutes of your slot. Cancel or reschedule at least 24 hours ahead.",
  },
  {
    key: "shipping",
    title: "Shipping and pickup",
    categories: ["order_status"],
    body: "In-stock orders ship within 2 business days and tracking is emailed when the label is created. Bikes ship 90% assembled. Pickup orders are held for 14 days once marked ready.",
  },
  {
    key: "store_hours",
    title: "Store hours and location",
    categories: ["general_question"],
    body: "Open Tuesday-Friday 10am-6pm, Saturday 9am-5pm and Sunday 11am-4pm. Closed Mondays. Free customer parking behind the shop; test rides available with a photo ID.",
  },
  {
    key: "warranty",
    title: "Warranty",
    categories: ["product_info", "service_repair"],
    body: "Frames and components carry the manufacturer's warranty. We handle warranty claims for bikes bought here: bring the bike and proof of purchase and we will inspect it and submit the claim. Crash damage is not covered.",
  },
  {
    key: "stock_and_holds",
    title: "Stock and holds",
    categories: ["product_availability", "product_info"],
    body: "Stock levels change daily. We can hold an in-stock bike for 48 hours with a phone call or email. Out-of-stock bikes can be special ordered; lead times vary by distributor.",
  },
];
