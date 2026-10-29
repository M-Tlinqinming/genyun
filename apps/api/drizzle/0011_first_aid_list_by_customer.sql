-- 急救药箱药品清单由客户填写，照片只作补充（Martin 10-29）。
-- 只传了药箱照片的：改为「自己逐项填」、清单清空待客户补（照片保留）；资料项从「拍照给耕云看」改为「稍后补」，不再等专家判断
UPDATE "enterprises"
SET "profile" = jsonb_set(
  jsonb_set("profile", '{resourcesStep,step,firstAidKit,mode}', '"manual"'),
  '{resourcesStep,step,firstAidKit,items}', '[]'
)
WHERE "profile" #>> '{resourcesStep,step,firstAidKit,mode}' = 'photo';--> statement-breakpoint
UPDATE "checklist_items"
SET "status" = 'later', "confirmed_by" = NULL, "confirmed_at" = NULL,
  "expert_result" = NULL, "expert_judged_by" = NULL, "expert_judged_at" = NULL, "updated_at" = now()
WHERE "item_key" = 'first_aid_kit' AND "status" = 'photo_for_expert';
