-- Plotëson 4 kategoritë që mungonin nga 043 (Birra, Alkool, Verë, Ushqime) +
-- artikujt e tyre, për klientin BABYLON. Njësoj si 043 — idempotent: vetëm
-- shton kategori/artikuj që NUK ekzistojnë ende (krahasim me emër, pa dallim
-- të madhe/vogël shkronjash). Nuk prek asgjë ekzistuese, as 4 kategoritë që
-- tashmë u futën nga 043 (Pije të nxehta, Pije të ftohta, Ëmbëlsira, Snacks).

DO $$
DECLARE
  v_client_id UUID;
  v_client_count INTEGER;
  v_cat_sort INTEGER;
  v_next_local_id INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_client_count FROM clients WHERE emri ILIKE '%BABYLON%';
  IF v_client_count = 0 THEN
    RAISE NOTICE '044: Klienti BABYLON nuk u gjet — seed anashkalohet (OK për projekt të ri bosh).';
    RETURN;
  ELSIF v_client_count > 1 THEN
    RAISE EXCEPTION 'U gjetën % klientë që përputhen me BABYLON — saktëso emrin te ky script para se ta ekzekutosh', v_client_count;
  END IF;

  SELECT id INTO v_client_id FROM clients WHERE emri ILIKE '%BABYLON%';

  -- 1) Sigurohu që 4 kategoritë që mungonin ekzistojnë tani (pa i prekur të tjerat)
  SELECT COALESCE(MAX(sort_order), -1) INTO v_cat_sort FROM pos_categories WHERE client_id = v_client_id;

  INSERT INTO pos_categories (client_id, name, sort_order)
  SELECT v_client_id, c.name, v_cat_sort + ROW_NUMBER() OVER (ORDER BY c.ord)
  FROM (VALUES
    (1, 'Birra'),
    (2, 'Alkool'),
    (3, 'Verë'),
    (4, 'Ushqime')
  ) AS c(ord, name)
  WHERE NOT EXISTS (
    SELECT 1 FROM pos_categories pc
    WHERE pc.client_id = v_client_id AND LOWER(TRIM(pc.name)) = LOWER(TRIM(c.name))
  );

  -- 2) Shto vetëm artikujt e këtyre 4 kategorive që nuk ekzistojnë ende
  SELECT COALESCE(MAX(local_id), 0) INTO v_next_local_id FROM pos_menu_items WHERE client_id = v_client_id;

  INSERT INTO pos_menu_items (client_id, local_id, name, category, price, active)
  SELECT v_client_id, v_next_local_id + ROW_NUMBER() OVER (ORDER BY new_items.ord), new_items.name, new_items.category, 0, true
  FROM (
    SELECT x.ord, x.name, x.category
    FROM (VALUES
      -- Birra
      (1,  'Lasko 0.33l',                'Birra'),
      (2,  'Heineken 0.33l',             'Birra'),
      (3,  'Peja 0.33l',                 'Birra'),
      (4,  'Tuborg 0.33l',               'Birra'),
      (5,  'Corona 0.33l',               'Birra'),
      (6,  'Birra draft e vogël',        'Birra'),
      (7,  'Birra draft e madhe',        'Birra'),
      -- Alkool
      (8,  'Raki e shtëpisë',            'Alkool'),
      (9,  'Raki e vjetër',              'Alkool'),
      (10, 'Johnny Walker',              'Alkool'),
      (11, 'Jameson',                    'Alkool'),
      (12, 'Chivas',                     'Alkool'),
      (13, 'Absolut',                    'Alkool'),
      (14, 'Smirnoff',                   'Alkool'),
      (15, 'Gordon''s Gin',              'Alkool'),
      (16, 'Bombay Gin',                 'Alkool'),
      (17, 'Tequila',                    'Alkool'),
      (18, 'Mojito',                     'Alkool'),
      (19, 'Margarita',                  'Alkool'),
      (20, 'Sex on the Beach',           'Alkool'),
      (21, 'Piña Colada',                'Alkool'),
      -- Verë
      (22, 'Verë e bardhë (shishe)',     'Verë'),
      (23, 'Verë e bardhë (gotë)',       'Verë'),
      (24, 'Verë e kuqe (shishe)',       'Verë'),
      (25, 'Verë e kuqe (gotë)',         'Verë'),
      (26, 'Verë rozë (shishe)',         'Verë'),
      (27, 'Verë rozë (gotë)',           'Verë'),
      -- Ushqime
      (28, 'Burger klasik',              'Ushqime'),
      (29, 'Cheeseburger',               'Ushqime'),
      (30, 'Sanduiç me proshutë',        'Ushqime'),
      (31, 'Sanduiç vegjetarian',        'Ushqime'),
      (32, 'Toast',                      'Ushqime'),
      (33, 'Pica Margarita',             'Ushqime'),
      (34, 'Pica Kapriçoza',             'Ushqime'),
      (35, 'Sallatë greke',              'Ushqime'),
      (36, 'Sallatë çezar',              'Ushqime')
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

  RAISE NOTICE 'BABYLON menu seed (044 — kategoritë e munguara): client_id=%, artikuj para=%, pas=%',
    v_client_id,
    v_next_local_id,
    (SELECT COUNT(*) FROM pos_menu_items WHERE client_id = v_client_id);
END $$;
