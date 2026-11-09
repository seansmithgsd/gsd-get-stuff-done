import json
STYLE = ("isometric game asset, three-quarter top-down view at 30 degrees, single building centered on a small square patch of grass, "
 "polished 3D mobile strategy game art in the style of a premium city builder, soft warm lighting from the top left, vibrant saturated colors, crisp clean details, "
 "entire building visible with margin around it, plain solid pure white background, no text, no letters, no people")
B = {
 'hut':'a small cozy wooden hut with a thatched straw roof, round wooden door and a little window',
 'hunt':'a hunting post: small log cabin with antlers over the door, a rack of drying hides and a bow and quiver leaning on it',
 'quarry':'a stone quarry: stacked cut grey stone blocks, a wooden lifting crane and pickaxes',
 'lumber':'a lumber camp: big stacked log pile, an axe stuck in a tree stump, a small wooden shed with a sawhorse',
 'farm':'a farm plot: neat tilled field rows of green crops and golden wheat with a low wooden fence and a scarecrow',
 'kiln':'a charcoal kiln: a domed brick kiln with smoke rising, stacked firewood beside it',
 'smelter':'a smelter: stone furnace with glowing orange molten metal pouring into a mold, tall stone chimney',
 'mint':'a mint: small stone building with a coin press, chests and stacks of shiny gold coins out front',
 'townhall':'a town hall: two-story timber and stone civic hall with a clock tower and a blue banner',
 'mine':'a mine entrance carved into a rocky hill with timber supports, rails and a mine cart full of ore',
 'sawmill':'a sawmill: timber mill with a turning water wheel, big circular saw and stacks of fresh planks',
 'market':'a market: wooden market stalls with striped red and white canopies, crates of fruit, sacks and goods',
 'taxoffice':'a tax office: small stone office with a coin chest, scales and ledgers on a desk by the door',
 'workshop':'a workshop: timber workshop with an anvil, workbench, hanging tools and a glowing forge',
 'longhouse':'a long wooden longhouse with a steep thatched roof, carved dragon gable ends and a smoking chimney',
 'dock':'a fishing dock: wooden pier over blue water with a small rowboat, fishing nets and barrels of fish',
 'orchard':'an orchard: a small grove of round fruit trees with red apples and wicker baskets full of fruit',
 'nursery':'a tree nursery: rows of young saplings in pots under a wooden greenhouse frame',
 'watchtower':'a tall wooden watchtower with a roofed lookout platform, ladder and a blue pennant flag',
 'blastfurnace':'a blast furnace: tall cylindrical brick furnace tower with glowing fire inside, coal pile and iron ore carts',
 'gearworks':'a gearworks: industrial brick workshop with huge brass gears and cogs turning on its facade',
 'bank':'a bank: classical white stone bank building with columns, gold trim and a big round vault door',
 'barracks':'a barracks: fortified stone barracks with weapon racks, shields and red banners',
 'quarry2':'a deep quarry pit: terraced open stone pit with ladders, ropes, pulleys and cut stone blocks',
 'teamhall':'a team hall: grand timber banquet hall with many colorful team banners and torches',
 'factory':'a factory: red brick factory with two tall smokestacks, sawtooth roof and a conveyor belt',
 'powerplant':'a power plant: coal power station with a concrete cooling tower, steam, and power line pylons',
 'outpost':'an outpost: small fortified frontier outpost with sharpened log walls, a gate, tents and a flag',
 'gsdtower':'a wonder: towering futuristic gold and royal blue skyscraper monument with a glowing golden emblem on top',
 'moneyprinter':'a wonder: giant ornate brass steampunk printing press machine spitting green banknotes and gold coins',
}
AGES = ['Stone Age: rough timber and thatch', 'Bronze Age: timber with bronze trim and clay tile roof', 'Iron Age: cut stone with iron bands and slate roof',
        'Industrial Age: red brick and riveted steel with a smokestack', 'Digital Age: sleek glass and steel with solar panels and glowing blue lights']
STAGED = {'tc':'a town center: the main village building, a large central hall with a flag', 'storehouse':'a storehouse: a warehouse full of crates, barrels and stacked materials', 'grainstore':'a granary: grain silo and storage barn with sacks of grain'}
jobs = [[k, f'{v}, {STYLE}'] for k, v in B.items()]
for k, v in STAGED.items():
    for n, a in enumerate(AGES): jobs.append([f'{k}_{n+1}', f'{v}, built in the {a}, {STYLE}'])
json.dump(jobs, open('/tmp/claude-0/-home-claude/5add54db-82b2-5cd9-a426-7a1a8cb840bd/scratchpad/jobs.json','w'))
print(len(jobs), len(json.dumps(jobs)))
