-- Shton artikuj menuje për klientin BABYLON (pos_menu_items) — idempotent:
-- vetëm shton artikujt që NUK ekzistojnë ende (krahasim me emër, pa dallim
-- të madhe/vogël shkronjash), asnjë artikull ekzistues nuk preket/fshihet.
-- Çmimet lihen 0 — pronari i vendos vetë te paneli.

DO $$
DECLARE
  v_client_id UUID;
  v_client_count INTEGER;
  v_cat_sort INTEGER;
  v_next_local_id INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_client_count FROM clients WHERE emri ILIKE '%BABYLON%';
  IF v_client_count = 0 THEN
    RAISE NOTICE '043: Klienti BABYLON nuk u gjet — seed anashkalohet (OK për projekt të ri bosh).';
    RETURN;
  ELSIF v_client_count > 1 THEN
    RAISE EXCEPTION 'U gjetën % klientë që përputhen me BABYLON — saktëso emrin te ky script para se ta ekzekutosh', v_client_count;
  END IF;

  SELECT id INTO v_client_id FROM clients WHERE emri ILIKE '%BABYLON%';

  -- 1) Sigurohu që kategoritë ekzistojnë (pa i prekur ato ekzistuese)
  SELECT COALESCE(MAX(sort_order), -1) INTO v_cat_sort FROM pos_categories WHERE client_id = v_client_id;

  INSERT INTO pos_categories (client_id, name, sort_order)
  SELECT v_client_id, c.name, v_cat_sort + ROW_NUMBER() OVER (ORDER BY c.ord)
  FROM (VALUES
    (1, 'Pije të nxehta'),
    (2, 'Pije të ftohta'),
    (3, 'Birra'),
    (4, 'Alkool'),
    (5, 'Verë'),
    (6, 'Ushqime'),
    (7, 'Ëmbëlsira'),
    (8, 'Snacks')
  ) AS c(ord, name)
  WHERE NOT EXISTS (
    SELECT 1 FROM pos_categories pc
    WHERE pc.client_id = v_client_id AND LOWER(TRIM(pc.name)) = LOWER(TRIM(c.name))
  );

  -- 2) Shto vetëm artikujt që nuk ekzistojnë ende (krahasim me emër)
  SELECT COALESCE(MAX(local_id), 0) INTO v_next_local_id FROM pos_menu_items WHERE client_id = v_client_id;

  INSERT INTO pos_menu_items (client_id, local_id, name, category, price, active)
  SELECT v_client_id, v_next_local_id + ROW_NUMBER() OVER (ORDER BY new_items.ord), new_items.name, new_items.category, 0, true
  FROM (
    SELECT x.ord, x.name, x.category
    FROM (VALUES
      -- Pije të nxehta
      (1,  'Espresso',                  'Pije të nxehta'),
      (2,  'Espresso Double',            'Pije të nxehta'),
      (3,  'Macchiato',                  'Pije të nxehta'),
      (4,  'Macchiato e madhe',          'Pije të nxehta'),
      (5,  'Kapuçino',                   'Pije të nxehta'),
      (6,  'Neskafe',                    'Pije të nxehta'),
      (7,  'Çaj',                        'Pije të nxehta'),
      (8,  'Çaj me mjaltë e limon',      'Pije të nxehta'),
      (9,  'Sahlep',                     'Pije të nxehta'),
      -- Pije të ftohta
      (10, 'Ujë 0.5l',                   'Pije të ftohta'),
      (11, 'Ujë 1.5l',                   'Pije të ftohta'),
      (12, 'Ujë i gazuar',               'Pije të ftohta'),
      (13, 'Coca-Cola',                  'Pije të ftohta'),
      (14, 'Fanta',                      'Pije të ftohta'),
      (15, 'Sprite',                     'Pije të ftohta'),
      (16, 'Schweppes',                  'Pije të ftohta'),
      (17, 'Lëng dredhëz',               'Pije të ftohta'),
      (18, 'Lëng pjeshkë',               'Pije të ftohta'),
      (19, 'Lëng mollë',                 'Pije të ftohta'),
      (20, 'Ice Tea',                    'Pije të ftohta'),
      (21, 'Limonadë',                   'Pije të ftohta'),
      -- Birra
      (22, 'Lasko 0.33l',                'Birra'),
      (23, 'Heineken 0.33l',             'Birra'),
      (24, 'Peja 0.33l',                 'Birra'),
      (25, 'Tuborg 0.33l',               'Birra'),
      (26, 'Corona 0.33l',               'Birra'),
      (27, 'Birra draft e vogël',        'Birra'),
      (28, 'Birra draft e madhe',        'Birra'),
      -- Alkool
      (29, 'Raki e shtëpisë',            'Alkool'),
      (30, 'Raki e vjetër',              'Alkool'),
      (31, 'Johnny Walker',              'Alkool'),
      (32, 'Jameson',                    'Alkool'),
      (33, 'Chivas',                     'Alkool'),
      (34, 'Absolut',                    'Alkool'),
      (35, 'Smirnoff',                   'Alkool'),
      (36, 'Gordon''s Gin',              'Alkool'),
      (37, 'Bombay Gin',                 'Alkool'),
      (38, 'Tequila',                    'Alkool'),
      (39, 'Mojito',                     'Alkool'),
      (40, 'Margarita',                  'Alkool'),
      (41, 'Sex on the Beach',           'Alkool'),
      (42, 'Piña Colada',                'Alkool'),
      -- Verë
      (43, 'Verë e bardhë (shishe)',     'Verë'),
      (44, 'Verë e bardhë (gotë)',       'Verë'),
      (45, 'Verë e kuqe (shishe)',       'Verë'),
      (46, 'Verë e kuqe (gotë)',         'Verë'),
      (47, 'Verë rozë (shishe)',         'Verë'),
      (48, 'Verë rozë (gotë)',           'Verë'),
      -- Ushqime
      (49, 'Burger klasik',              'Ushqime'),
      (50, 'Cheeseburger',               'Ushqime'),
      (51, 'Sanduiç me proshutë',        'Ushqime'),
      (52, 'Sanduiç vegjetarian',        'Ushqime'),
      (53, 'Toast',                      'Ushqime'),
      (54, 'Pica Margarita',             'Ushqime'),
      (55, 'Pica Kapriçoza',             'Ushqime'),
      (56, 'Sallatë greke',              'Ushqime'),
      (57, 'Sallatë çezar',              'Ushqime'),
      -- Ëmbëlsira
      (58, 'Bakllavë',                   'Ëmbëlsira'),
      (59, 'Trileçe',                    'Ëmbëlsira'),
      (60, 'Tortë me çokollatë',         'Ëmbëlsira'),
      (61, 'Cheesecake',                 'Ëmbëlsira'),
      (62, 'Akullore (kuglla)',          'Ëmbëlsira'),
      (63, 'Fruta të stinës',            'Ëmbëlsira'),
      -- Snacks
      (64, 'Patatina',                   'Snacks'),
      (65, 'Kikirikë',                   'Snacks'),
      (66, 'Bajame',                     'Snacks'),
      (67, 'Fëstëkë',                    'Snacks'),
      (68, 'Mix të thata',               'Snacks')
    ) AS x(ord, name, category)
    WHERE NOT EXISTS (
      SELECT 1 FROM pos_menu_items pmi
      WHERE pmi.client_id = v_client_id AND LOWER(TRIM(pmi.name)) = LOWER(TRIM(x.name))
    )
  ) AS new_items;

  -- 3) Shëno katalogun si të freskët, që QR/Takeaway/waiter phone ta marrin menjëherë
  INSERT INTO pos_settings (client_id, table_count, receipt_width_mm, synced_at)
  VALUES (v_client_id, 10, 80, now())
  ON CONFLICT (client_id) DO UPDATE SET synced_at = now();

  RAISE NOTICE 'BABYLON menu seed: client_id=%, artikuj para=%, pas=%',
    v_client_id,
    v_next_local_id,
    (SELECT COUNT(*) FROM pos_menu_items WHERE client_id = v_client_id);
END $$;
