Use the $imagegen skill (the built-in image_gen tool, one call per image) to generate THREE different images. After generating, copy each selected PNG into the current working directory as layout-1.png, layout-2.png and layout-3.png. Do not write scripts, do not edit or create any other files. Finish by replying with the three file names only.

Each image is a top-down 2D overview of an ORIGINAL level layout for a tactical team-based FPS map with three lanes and two objective sites, drawn like a clean competitive-shooter overview map. It must be a new invention: do NOT copy or imitate any existing map (no Dust2, Mirage, Inferno, Nuke, Cache, Overpass, Ascent, etc.). The three images should be three clearly different layouts.

The image will be parsed by a program, so follow these flat-graphic rules exactly:
- Pure white (#FFFFFF) = solid, unwalkable. The walkable area must NOT be a filled rectangle or square. It is an irregular network of streets, corridors, rooms and courtyards, with big white solid blocks between the lanes, and an uneven outer outline with protrusions, notches and dead-end nooks.
- Walkable floors are flat solid colors with sharp edges. No textures, no gradients, no shading, no drop shadows, no text, no letters, no numbers, no icons, no grid lines, no perspective, no 3D.
  - ground-level floor: slate blue #4F6B78
  - raised floor (about 3 m higher, overlooks other areas): olive green #6E7F4A
  - sunken floor (about 3 m lower, e.g. a tunnel or a pit): dark navy #22313F
  - stairs / ramps that connect different floor levels: bright yellow #F4C542 rectangles
  - small cover objects (crates, low walls): light gray #B4B4B4 small rectangles placed inside floors
  - objective site A: a floor region surrounded by a thin bright orange #FF7A00 outline
  - objective site B: a floor region surrounded by a thin magenta #E0399B outline
  - attacker spawn (bottom edge): solid bright green #35C74A area
  - defender spawn (top edge): solid red #E53935 area
- Layout: attacker spawn at the bottom, defender spawn at the top. Site A in the upper-left region, site B in the upper-right region. From the attacker spawn, three lanes: a left lane of narrow winding corridors that dips into a sunken tunnel and comes up near site A; a middle lane through a central street with a choke point and a connector that branches toward both sites; a right lane that is a long, wide street with a long sightline and a sharp corner before site B. Defenders have short rotation paths between the two sites behind them. Corridors are 3-6% of the image width wide; courtyards and sites are bigger. Everything walkable is connected. Include loops and alternate routes, two or three raised green areas overlooking lanes with yellow stairs, and at least one sunken navy area.
- Square image, 1024x1024. The map fills most of the frame with a white margin around it.
