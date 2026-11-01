CREATE TABLE "agency_regions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"province" text NOT NULL,
	"city" text NOT NULL,
	"name" text NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"plan" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "holidays" (
	"date" date PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "local_agencies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"region_id" uuid NOT NULL,
	"category" text NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"area" text,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"plan" text,
	"note" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"disabled_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"verified_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "process_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"industry" text,
	"keywords" text[] DEFAULT '{}'::text[] NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"draft" jsonb,
	"version" integer DEFAULT 0 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"disabled_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "local_agencies" ADD CONSTRAINT "local_agencies_region_id_agency_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."agency_regions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "local_agencies" ADD CONSTRAINT "local_agencies_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_templates" ADD CONSTRAINT "process_templates_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agency_regions_name" ON "agency_regions" USING btree ("province","city","name");--> statement-breakpoint
CREATE INDEX "local_agencies_region" ON "local_agencies" USING btree ("region_id");--> statement-breakpoint
-- 初始数据：原来写在代码里的惠州属地应急机构、2026 年节假日、工艺模板，原样写入；已有就跳过
INSERT INTO "agency_regions" ("province", "city", "name", "aliases", "plan", "sort_order") VALUES ('广东省', '惠州市', '仲恺高新区', ARRAY['仲恺']::text[], '仲恺高新区生产工贸行业事故应急预案', 0) ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "local_agencies" ("region_id", "category", "name", "phone", "area", "aliases", "plan", "sort_order")
SELECT r."id", v."category", v."name", v."phone", v."area", v."aliases", v."plan", v."sort_order" FROM "agency_regions" r, (VALUES
  ('emergency', '惠州市仲恺高新区应急管理局', '0752-3271385', NULL, '{}'::text[], NULL, 0),
  ('fire', '仲恺高新区消防救援大队', '0752-3165029', NULL, '{}'::text[], NULL, 1),
  ('street', '陈江街道应急管理办公室', '0752-3896139', '陈江街道', '{}'::text[], '陈江街道生产安全事故应急预案', 2),
  ('street', '惠环街道应急管理办公室', '0752-2618181', '惠环街道', '{}'::text[], '惠环街道生产安全事故应急预案', 3),
  ('street', '沥林镇应急管理办公室', '0752-3868110', '沥林镇', '{}'::text[], '沥林镇生产安全事故应急预案', 4),
  ('street', '潼侨镇应急管理办公室', '0752-3791373', '潼侨镇', '{}'::text[], '潼侨镇生产安全事故应急预案', 5),
  ('street', '潼湖镇应急管理办公室', '0752-3886020', '潼湖镇', '{}'::text[], '潼湖镇生产安全事故应急预案', 6),
  ('street', '东江科技园应急管理办公室', '0752-2380110', '东江科技园', '{}'::text[], NULL, 7),
  ('street', '惠南科技园应急管理办公室', '0752-2598808', '惠南科技园', '{}'::text[], NULL, 8)
) AS v("category", "name", "phone", "area", "aliases", "plan", "sort_order")
WHERE r."province" = '广东省' AND r."city" = '惠州市' AND r."name" = '仲恺高新区' AND NOT EXISTS (SELECT 1 FROM "local_agencies" a WHERE a."region_id" = r."id");--> statement-breakpoint
INSERT INTO "agency_regions" ("province", "city", "name", "aliases", "plan", "sort_order") VALUES ('广东省', '惠州市', '惠城区', ARRAY['惠城']::text[], '惠城区生产安全事故应急预案', 1) ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "local_agencies" ("region_id", "category", "name", "phone", "area", "aliases", "plan", "sort_order")
SELECT r."id", v."category", v."name", v."phone", v."area", v."aliases", v."plan", v."sort_order" FROM "agency_regions" r, (VALUES
  ('emergency', '惠州市惠城区应急管理局', '0752-7809633', NULL, '{}'::text[], NULL, 0),
  ('fire', '惠城区消防救援大队', '0752-2223119', NULL, '{}'::text[], NULL, 1),
  ('street', '桥东街道应急管理办公室', '0752-2257110', '桥东街道', '{}'::text[], '桥东街道生产安全事故应急预案', 2),
  ('street', '桥西街道应急管理办公室', '0752-2382278', '桥西街道', '{}'::text[], '桥西街道生产安全事故应急预案', 3),
  ('street', '龙丰街道应急管理办公室', '0752-2289011', '龙丰街道', '{}'::text[], '龙丰街道生产安全事故应急预案', 4),
  ('street', '江南街道应急管理办公室', '0752-2248502', '江南街道', '{}'::text[], '江南街道生产安全事故应急预案', 5),
  ('street', '江北街道应急管理办公室', '0752-2802552', '江北街道', '{}'::text[], '江北街道生产安全事故应急预案', 6),
  ('street', '河南岸街道应急管理办公室', '0752-2526976', '河南岸街道', '{}'::text[], '河南岸街道生产安全事故应急预案', 7),
  ('street', '小金口街道应急管理办公室', '0752-2290820', '小金口街道', '{}'::text[], '小金口街道生产安全事故应急预案', 8),
  ('street', '水口街道应急管理办公室', '0752-2312399', '水口街道', '{}'::text[], '水口街道生产安全事故应急预案', 9),
  ('street', '马安镇应急管理办公室', '0752-3617568', '马安镇', '{}'::text[], '马安镇生产安全事故应急预案', 10),
  ('street', '三栋镇应急管理办公室', '0752-2599669', '三栋镇', '{}'::text[], '三栋镇生产安全事故应急预案', 11),
  ('street', '汝湖镇应急管理办公室', '0752-2796789', '汝湖镇', '{}'::text[], '汝湖镇生产安全事故应急预案', 12),
  ('street', '横沥镇应急管理办公室', '0752-3183921', '横沥镇', '{}'::text[], '横沥镇生产安全事故应急预案', 13),
  ('street', '芦洲镇应急管理办公室', '0752-3287751', '芦洲镇', '{}'::text[], '芦洲镇生产安全事故应急预案', 14)
) AS v("category", "name", "phone", "area", "aliases", "plan", "sort_order")
WHERE r."province" = '广东省' AND r."city" = '惠州市' AND r."name" = '惠城区' AND NOT EXISTS (SELECT 1 FROM "local_agencies" a WHERE a."region_id" = r."id");--> statement-breakpoint
INSERT INTO "agency_regions" ("province", "city", "name", "aliases", "plan", "sort_order") VALUES ('广东省', '惠州市', '惠阳区', ARRAY['惠阳']::text[], '惠阳区生产安全事故应急预案', 2) ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "local_agencies" ("region_id", "category", "name", "phone", "area", "aliases", "plan", "sort_order")
SELECT r."id", v."category", v."name", v."phone", v."area", v."aliases", v."plan", v."sort_order" FROM "agency_regions" r, (VALUES
  ('emergency', '惠州市惠阳区应急管理局', '0752-3362119', NULL, '{}'::text[], NULL, 0),
  ('fire', '惠阳区消防救援大队', '0752-3814218', NULL, '{}'::text[], NULL, 1),
  ('street', '淡水街道应急管理办公室', '0752-3360690', '淡水街道', '{}'::text[], '淡水街道生产安全事故应急预案', 2),
  ('street', '秋长街道应急管理办公室', '0752-3557885', '秋长街道', '{}'::text[], '秋长街道生产安全事故应急预案', 3),
  ('street', '三和街道应急管理办公室', '0752-3502038', '三和街道', ARRAY['拾围村']::text[], '三和街道生产安全事故应急预案', 4),
  ('street', '沙田镇应急管理办公室', '0752-3754119', '沙田镇', '{}'::text[], '沙田镇生产安全事故应急预案', 5),
  ('street', '新圩镇应急管理办公室', '0752-3330001', '新圩镇', '{}'::text[], '新圩镇生产安全事故应急预案', 6),
  ('street', '镇隆镇应急管理办公室', '0752-3699129', '镇隆镇', '{}'::text[], '镇隆镇生产安全事故应急预案', 7),
  ('street', '永湖镇应急管理办公室', '0752-3714127', '永湖镇', '{}'::text[], '永湖镇生产安全事故应急预案', 8),
  ('street', '良井镇应急管理办公室', '0752-3651926', '良井镇', '{}'::text[], '良井镇生产安全事故应急预案', 9),
  ('street', '平潭镇应急管理办公室', '0752-3303333', '平潭镇', '{}'::text[], '平潭镇生产安全事故应急预案', 10)
) AS v("category", "name", "phone", "area", "aliases", "plan", "sort_order")
WHERE r."province" = '广东省' AND r."city" = '惠州市' AND r."name" = '惠阳区' AND NOT EXISTS (SELECT 1 FROM "local_agencies" a WHERE a."region_id" = r."id");--> statement-breakpoint
INSERT INTO "agency_regions" ("province", "city", "name", "aliases", "plan", "sort_order") VALUES ('广东省', '惠州市', '惠东县', ARRAY['惠东']::text[], '惠东县生产安全事故应急预案', 3) ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "local_agencies" ("region_id", "category", "name", "phone", "area", "aliases", "plan", "sort_order")
SELECT r."id", v."category", v."name", v."phone", v."area", v."aliases", v."plan", v."sort_order" FROM "agency_regions" r, (VALUES
  ('emergency', '惠东县应急管理局', '0752-8811235', NULL, '{}'::text[], NULL, 0),
  ('fire', '惠东县消防救援大队', '0752-8890119', NULL, '{}'::text[], NULL, 1),
  ('street', '平山街道应急管理办公室', NULL, '平山街道', '{}'::text[], '平山街道生产安全事故应急预案', 2),
  ('street', '大岭街道应急管理办公室', NULL, '大岭街道', '{}'::text[], '大岭街道生产安全事故应急预案', 3),
  ('street', '白花镇应急管理办公室', NULL, '白花镇', '{}'::text[], '白花镇生产安全事故应急预案', 4),
  ('street', '多祝镇应急管理办公室', NULL, '多祝镇', '{}'::text[], '多祝镇生产安全事故应急预案', 5),
  ('street', '稔山镇应急管理办公室', NULL, '稔山镇', '{}'::text[], '稔山镇生产安全事故应急预案', 6),
  ('street', '梁化镇应急管理办公室', NULL, '梁化镇', '{}'::text[], '梁化镇生产安全事故应急预案', 7),
  ('street', '平海镇应急管理办公室', NULL, '平海镇', '{}'::text[], '平海镇生产安全事故应急预案', 8),
  ('street', '铁涌镇应急管理办公室', NULL, '铁涌镇', '{}'::text[], '铁涌镇生产安全事故应急预案', 9),
  ('street', '吉隆镇应急管理办公室', NULL, '吉隆镇', '{}'::text[], '吉隆镇生产安全事故应急预案', 10),
  ('street', '黄埠镇应急管理办公室', NULL, '黄埠镇', '{}'::text[], '黄埠镇生产安全事故应急预案', 11),
  ('street', '白盆珠镇应急管理办公室', NULL, '白盆珠镇', '{}'::text[], '白盆珠镇生产安全事故应急预案', 12),
  ('street', '高潭镇应急管理办公室', NULL, '高潭镇', '{}'::text[], '高潭镇生产安全事故应急预案', 13),
  ('street', '安墩镇应急管理办公室', NULL, '安墩镇', '{}'::text[], '安墩镇生产安全事故应急预案', 14),
  ('street', '宝口镇应急管理办公室', NULL, '宝口镇', '{}'::text[], '宝口镇生产安全事故应急预案', 15)
) AS v("category", "name", "phone", "area", "aliases", "plan", "sort_order")
WHERE r."province" = '广东省' AND r."city" = '惠州市' AND r."name" = '惠东县' AND NOT EXISTS (SELECT 1 FROM "local_agencies" a WHERE a."region_id" = r."id");--> statement-breakpoint
INSERT INTO "agency_regions" ("province", "city", "name", "aliases", "plan", "sort_order") VALUES ('广东省', '惠州市', '博罗县', ARRAY['博罗']::text[], '博罗县生产安全事故应急预案', 4) ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "local_agencies" ("region_id", "category", "name", "phone", "area", "aliases", "plan", "sort_order")
SELECT r."id", v."category", v."name", v."phone", v."area", v."aliases", v."plan", v."sort_order" FROM "agency_regions" r, (VALUES
  ('emergency', '博罗县应急管理局', '0752-6635600', NULL, '{}'::text[], NULL, 0),
  ('fire', '博罗县消防救援大队', '0752-6283119', NULL, '{}'::text[], NULL, 1),
  ('street', '罗阳街道应急管理办公室', '0752-6633655', '罗阳街道', '{}'::text[], '罗阳街道生产安全事故应急预案', 2),
  ('street', '龙溪街道应急管理办公室', '0752-6678007', '龙溪街道', '{}'::text[], '龙溪街道生产安全事故应急预案', 3),
  ('street', '园洲镇应急管理办公室', '0752-6689909', '园洲镇', '{}'::text[], '园洲镇生产安全事故应急预案', 4),
  ('street', '湖镇镇应急管理办公室', '0752-6657567', '湖镇镇', '{}'::text[], '湖镇镇生产安全事故应急预案', 5),
  ('street', '石湾镇应急管理办公室', '0752-6610026', '石湾镇', '{}'::text[], '石湾镇生产安全事故应急预案', 6),
  ('street', '杨村镇应急管理办公室', '0752-6691200', '杨村镇', '{}'::text[], '杨村镇生产安全事故应急预案', 7),
  ('street', '公庄镇应急管理办公室', '0752-6115201', '公庄镇', '{}'::text[], '公庄镇生产安全事故应急预案', 8),
  ('street', '长宁镇应急管理办公室', '0752-6660516', '长宁镇', '{}'::text[], '长宁镇生产安全事故应急预案', 9),
  ('street', '横河镇应急管理办公室', '0752-6380203', '横河镇', '{}'::text[], '横河镇生产安全事故应急预案', 10),
  ('street', '龙华镇应急管理办公室', '0752-6862928', '龙华镇', '{}'::text[], '龙华镇生产安全事故应急预案', 11),
  ('street', '柏塘镇应急管理办公室', '0752-6330125', '柏塘镇', '{}'::text[], '柏塘镇生产安全事故应急预案', 12),
  ('street', '泰美镇应急管理办公室', '0752-6605336', '泰美镇', '{}'::text[], '泰美镇生产安全事故应急预案', 13),
  ('street', '杨侨镇应急管理办公室', '0752-6690212', '杨侨镇', '{}'::text[], '杨侨镇生产安全事故应急预案', 14),
  ('street', '麻陂镇应急管理办公室', '0752-6130088', '麻陂镇', '{}'::text[], '麻陂镇生产安全事故应急预案', 15),
  ('street', '观音阁镇应急管理办公室', '0752-6233255', '观音阁镇', '{}'::text[], '观音阁镇生产安全事故应急预案', 16),
  ('street', '石坝镇应急管理办公室', '0752-6160019', '石坝镇', '{}'::text[], '石坝镇生产安全事故应急预案', 17),
  ('street', '福田镇应急管理办公室', '0752-6886119', '福田镇', '{}'::text[], '福田镇生产安全事故应急预案', 18)
) AS v("category", "name", "phone", "area", "aliases", "plan", "sort_order")
WHERE r."province" = '广东省' AND r."city" = '惠州市' AND r."name" = '博罗县' AND NOT EXISTS (SELECT 1 FROM "local_agencies" a WHERE a."region_id" = r."id");--> statement-breakpoint
INSERT INTO "agency_regions" ("province", "city", "name", "aliases", "plan", "sort_order") VALUES ('广东省', '惠州市', '龙门县', ARRAY['龙门']::text[], '龙门县生产安全事故应急预案', 5) ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "local_agencies" ("region_id", "category", "name", "phone", "area", "aliases", "plan", "sort_order")
SELECT r."id", v."category", v."name", v."phone", v."area", v."aliases", v."plan", v."sort_order" FROM "agency_regions" r, (VALUES
  ('emergency', '龙门县应急管理局', '0752-7889202', NULL, '{}'::text[], NULL, 0),
  ('fire', '龙门县消防救援大队', '0752-7872968', NULL, '{}'::text[], NULL, 1),
  ('street', '龙城街道应急管理办公室', '0752-7882780', '龙城街道', '{}'::text[], '龙城街道生产安全事故应急预案', 2),
  ('street', '平陵街道应急管理办公室', '0752-7303201', '平陵街道', '{}'::text[], '平陵街道生产安全事故应急预案', 3),
  ('street', '龙田镇应急管理办公室', '0752-7789080', '龙田镇', '{}'::text[], '龙田镇生产安全事故应急预案', 4),
  ('street', '麻榨镇应急管理办公室', '0752-7560044', '麻榨镇', '{}'::text[], '麻榨镇生产安全事故应急预案', 5),
  ('street', '永汉镇应急管理办公室', '0752-7600728', '永汉镇', '{}'::text[], '永汉镇生产安全事故应急预案', 6),
  ('street', '龙潭镇应急管理办公室', '0752-7721128', '龙潭镇', '{}'::text[], '龙潭镇生产安全事故应急预案', 7),
  ('street', '地派镇应急管理办公室', '0752-7230081', '地派镇', '{}'::text[], '地派镇生产安全事故应急预案', 8),
  ('street', '龙华镇应急管理办公室', '0752-7361000', '龙华镇', '{}'::text[], '龙华镇生产安全事故应急预案', 9),
  ('street', '龙江镇应急管理办公室', '0752-7330010', '龙江镇', '{}'::text[], '龙江镇生产安全事故应急预案', 10),
  ('street', '蓝田瑶族乡应急管理办公室', '0752-7235619', '蓝田瑶族乡', '{}'::text[], '蓝田瑶族乡生产安全事故应急预案', 11)
) AS v("category", "name", "phone", "area", "aliases", "plan", "sort_order")
WHERE r."province" = '广东省' AND r."city" = '惠州市' AND r."name" = '龙门县' AND NOT EXISTS (SELECT 1 FROM "local_agencies" a WHERE a."region_id" = r."id");--> statement-breakpoint
INSERT INTO "agency_regions" ("province", "city", "name", "aliases", "plan", "sort_order") VALUES ('广东省', '惠州市', '大亚湾区', ARRAY['大亚湾']::text[], NULL, 6) ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "local_agencies" ("region_id", "category", "name", "phone", "area", "aliases", "plan", "sort_order")
SELECT r."id", v."category", v."name", v."phone", v."area", v."aliases", v."plan", v."sort_order" FROM "agency_regions" r, (VALUES
  ('emergency', '惠州大亚湾经济技术开发区应急管理局', '0752-5562928', NULL, '{}'::text[], NULL, 0),
  ('fire', '大亚湾区消防救援大队', '0752-5108905', NULL, '{}'::text[], NULL, 1)
) AS v("category", "name", "phone", "area", "aliases", "plan", "sort_order")
WHERE r."province" = '广东省' AND r."city" = '惠州市' AND r."name" = '大亚湾区' AND NOT EXISTS (SELECT 1 FROM "local_agencies" a WHERE a."region_id" = r."id");--> statement-breakpoint
INSERT INTO "holidays" ("date", "kind", "name") VALUES
  ('2026-01-01', 'holiday', '元旦'),
  ('2026-01-02', 'holiday', '元旦'),
  ('2026-01-03', 'holiday', '元旦'),
  ('2026-01-04', 'workday', '元旦调休'),
  ('2026-02-15', 'holiday', '春节'),
  ('2026-02-16', 'holiday', '春节'),
  ('2026-02-17', 'holiday', '春节'),
  ('2026-02-18', 'holiday', '春节'),
  ('2026-02-19', 'holiday', '春节'),
  ('2026-02-20', 'holiday', '春节'),
  ('2026-02-21', 'holiday', '春节'),
  ('2026-02-22', 'holiday', '春节'),
  ('2026-02-23', 'holiday', '春节'),
  ('2026-02-14', 'workday', '春节调休'),
  ('2026-02-28', 'workday', '春节调休'),
  ('2026-04-04', 'holiday', '清明节'),
  ('2026-04-05', 'holiday', '清明节'),
  ('2026-04-06', 'holiday', '清明节'),
  ('2026-05-01', 'holiday', '劳动节'),
  ('2026-05-02', 'holiday', '劳动节'),
  ('2026-05-03', 'holiday', '劳动节'),
  ('2026-05-04', 'holiday', '劳动节'),
  ('2026-05-05', 'holiday', '劳动节'),
  ('2026-05-09', 'workday', '劳动节调休'),
  ('2026-06-19', 'holiday', '端午节'),
  ('2026-06-20', 'holiday', '端午节'),
  ('2026-06-21', 'holiday', '端午节'),
  ('2026-09-25', 'holiday', '中秋节'),
  ('2026-09-26', 'holiday', '中秋节'),
  ('2026-09-27', 'holiday', '中秋节'),
  ('2026-09-20', 'workday', '中秋节调休'),
  ('2026-10-01', 'holiday', '国庆节'),
  ('2026-10-02', 'holiday', '国庆节'),
  ('2026-10-03', 'holiday', '国庆节'),
  ('2026-10-04', 'holiday', '国庆节'),
  ('2026-10-05', 'holiday', '国庆节'),
  ('2026-10-06', 'holiday', '国庆节'),
  ('2026-10-07', 'holiday', '国庆节'),
  ('2026-10-10', 'workday', '国庆节调休')
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "process_templates" ("id", "label", "keywords", "steps", "version", "sort_order", "published_at") VALUES ('lithium_battery', '锂电池组装（电芯封装）', ARRAY['锂电', '电池', '电芯']::text[], '[{"name":"喷码","equipment":["喷码机"],"materials":[],"risks":[]},{"name":"裁切","equipment":["裁切机"],"materials":[],"risks":[]},{"name":"打印","equipment":["打印机"],"materials":[],"risks":[]},{"name":"电芯检测","equipment":["检测柜"],"materials":[],"risks":[]},{"name":"电芯包装","equipment":[],"materials":[],"risks":[]},{"name":"电焊插头线","equipment":["点焊机"],"materials":[],"risks":[]},{"name":"装热缩套管","equipment":["热风枪"],"materials":[],"risks":[]},{"name":"成品检测","equipment":["检测柜"],"materials":[],"risks":[]},{"name":"外观检测","equipment":[],"materials":[],"risks":[]},{"name":"装盘装箱","equipment":[],"materials":[],"risks":[]}]'::jsonb, 1, 0, now()) ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "process_templates" ("id", "label", "keywords", "steps", "version", "sort_order", "published_at") VALUES ('smt', 'SMT 电子装配', ARRAY['SMT', '贴片', '电路板', '线路板', 'PCB', '电子元器件', '电子产品']::text[], '[{"name":"来料检验","equipment":[],"materials":[],"risks":[]},{"name":"锡膏印刷","equipment":["锡膏印刷机"],"materials":[],"risks":[]},{"name":"贴片","equipment":["贴片机"],"materials":[],"risks":[]},{"name":"回流焊","equipment":["回流焊炉"],"materials":[],"risks":[]},{"name":"AOI 检测","equipment":["AOI 检测仪"],"materials":[],"risks":[]},{"name":"插件","equipment":[],"materials":[],"risks":[]},{"name":"波峰焊","equipment":["波峰焊机"],"materials":[],"risks":[]},{"name":"手工补焊","equipment":["电烙铁"],"materials":[],"risks":[]},{"name":"功能测试","equipment":[],"materials":[],"risks":[]},{"name":"包装入库","equipment":[],"materials":[],"risks":[]}]'::jsonb, 1, 1, now()) ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "process_templates" ("id", "label", "keywords", "steps", "version", "sort_order", "published_at") VALUES ('injection_molding', '塑料注塑', ARRAY['注塑', '塑料制品', '塑胶']::text[], '[{"name":"原料烘干","equipment":["干燥机"],"materials":[],"risks":[]},{"name":"配色混料","equipment":["混料机"],"materials":[],"risks":[]},{"name":"注塑成型","equipment":["注塑机"],"materials":[],"risks":[]},{"name":"去水口修边","equipment":[],"materials":[],"risks":[]},{"name":"水口料粉碎","equipment":["粉碎机"],"materials":[],"risks":[]},{"name":"品质检验","equipment":[],"materials":[],"risks":[]},{"name":"包装入库","equipment":[],"materials":[],"risks":[]}]'::jsonb, 1, 2, now()) ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "process_templates" ("id", "label", "keywords", "steps", "version", "sort_order", "published_at") VALUES ('metal_stamping', '五金冲压', ARRAY['冲压', '五金', '钣金']::text[], '[{"name":"下料","equipment":["剪板机"],"materials":[],"risks":[]},{"name":"冲压成型","equipment":["冲床"],"materials":[],"risks":[]},{"name":"折弯","equipment":["折弯机"],"materials":[],"risks":[]},{"name":"攻牙","equipment":["攻牙机"],"materials":[],"risks":[]},{"name":"去毛刺","equipment":[],"materials":[],"risks":[]},{"name":"品质检验","equipment":[],"materials":[],"risks":[]},{"name":"包装入库","equipment":[],"materials":[],"risks":[]}]'::jsonb, 1, 3, now()) ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "process_templates" ("id", "label", "keywords", "steps", "version", "sort_order", "published_at") VALUES ('spraying', '喷涂', ARRAY['喷涂', '喷漆', '涂装', '喷塑', '喷粉']::text[], '[{"name":"除油清洗","equipment":[],"materials":[],"risks":[]},{"name":"打磨","equipment":["打磨机"],"materials":[],"risks":[]},{"name":"遮蔽","equipment":[],"materials":[],"risks":[]},{"name":"喷涂","equipment":["喷漆房"],"materials":[],"risks":[]},{"name":"流平","equipment":[],"materials":[],"risks":[]},{"name":"烘干固化","equipment":["烘箱"],"materials":[],"risks":[]},{"name":"品质检验","equipment":[],"materials":[],"risks":[]},{"name":"包装入库","equipment":[],"materials":[],"risks":[]}]'::jsonb, 1, 4, now()) ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "process_templates" ("id", "label", "keywords", "steps", "version", "sort_order", "published_at") VALUES ('furniture', '家具木加工', ARRAY['家具', '木制品', '木材加工', '板式', '实木']::text[], '[{"name":"开料","equipment":["裁板锯"],"materials":[],"risks":[]},{"name":"封边","equipment":["封边机"],"materials":[],"risks":[]},{"name":"钻孔","equipment":["排钻"],"materials":[],"risks":[]},{"name":"砂光","equipment":["砂光机"],"materials":[],"risks":[]},{"name":"喷漆","equipment":["喷漆房"],"materials":[],"risks":[]},{"name":"晾干","equipment":[],"materials":[],"risks":[]},{"name":"组装","equipment":[],"materials":[],"risks":[]},{"name":"检验包装","equipment":[],"materials":[],"risks":[]}]'::jsonb, 1, 5, now()) ON CONFLICT DO NOTHING;
