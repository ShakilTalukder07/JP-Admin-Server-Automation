# 🚀 JP Admin Bot: নতুন সার্ভার ও গুগল শিট সেটআপ গাইড

ভবিষ্যতের রেফারেন্সের জন্য এই ফাইলটিতে সম্পূর্ণ গাইড সংরক্ষণ করা হলো।

---

## 📋 চেকলিস্ট

1. [ ] নতুন Google Sheet তৈরি ও Apps Script Web App ডিপ্লয়মেন্ট
2. [ ] Discord Developer Portal-এ Intents অন করা
3. [ ] সার্ভারে বট ইনভাইট ও Administrator পারমিশন দেওয়া
4. [ ] `.env` ফাইল কনফিগারেশন আপডেট
5. [ ] বট চালু করা ও `!setup` বা `/setup` কমান্ড রান করা

---

## ধাপ ১: নতুন Google Sheet ও Apps Script ডিপ্লয়মেন্ট

1. **Sheet কপি:**
   - আগের মূল Google Sheet-টিতে গিয়ে **File ➔ Make a copy** করুন।
2. **Apps Script:**
   - নতুন Sheet-এর **Extensions ➔ Apps Script**-এ যান। `Code-v19-FINAL.gs` কোড ঠিক আছে কি না দেখে নিন।
3. **Web App হিসেবে ডিপ্লয়:**
   - উপরে ডানপাশে **Deploy ➔ New deployment**-এ যান।
   - **Type**: `Web app`
   - **Execute as**: `Me`
   - **Who has access**: `Anyone` (বাধ্যতামূলক)
   - **Deploy** করে পারমিশন দিন।
4. **URL সংরক্ষণ:**
   - প্রাপ্ত `/exec` URL এবং স্ক্রিপ্টের ভেতর থাকা `API_KEY` সংরক্ষণ করুন।

---

## ধাপ ২: Discord Developer Portal কনফিগারেশন

1. [Discord Developer Portal](https://discord.com/developers/applications)-এ যান।
2. আপনার Bot অ্যাপ্লিকেশনে ক্লিক করে বাম পাশের **Bot** ট্যাবে যান।
3. **Privileged Gateway Intents** সেকশনে নিচের অপশনগুলো Enable করুন:
   - ✅ **PRESENCE INTENT**
   - ✅ **SERVER MEMBERS INTENT**
   - ✅ **MESSAGE CONTENT INTENT**
4. **Save Changes** ক্লিক করুন।

---

## ধাপ ৩: বট ইনভাইট ও সার্ভার পারমিশন

1. ইনভাইট লিংক:
   ```text
   https://discord.com/oauth2/authorize?client_id=1523333978071761096&permissions=8&scope=bot%20applications.commands
   ```
2. সার্ভারে অ্যাড করার পর **Server Settings ➔ Roles**-এ গিয়ে নিশ্চিত করুন বট রোলে **Administrator** অন আছে।

---

## ধাপ ৪: `.env` ফাইল কনফিগারেশন

নতুন শিট ও সার্ভারের তথ্য দিয়ে `.env` আপডেট করুন:

```env
DISCORD_TOKEN=আপনার_টোকেন
JP_INSTALLER_MODE=true

COHORT_API_URL=https://script.google.com/macros/s/XXXX/exec
COHORT_API_KEY=আপনার_সিক্রেট_কী
COHORT_NAME=EJP-14
COHORT_TIMEZONE=Asia/Dhaka
```

---

## ধাপ ৫: বট চালু করা ও সেটআপ কমান্ড

1. টার্মিনালে রান করুন:
   ```bash
   npm start
   ```
2. সার্ভারে অ্যাডমিন আইডি থেকে মেসেজ পাঠান:
   ```text
   !setup
   ```
   *(অথবা স্ল্যাশ কমান্ড: `/setup`)*
3. বট `#bot-admin` চ্যানেল তৈরি করবে। সেখানে প্যানেলের ৪টি বাটন পরপর চাপুন:
   - `1 · Google permissions`
   - `2 · Match channels` (সব চ্যানেল স্বয়ংক্রিয়ভাবে তৈরি হবে)
   - `3 · Sync students`
   - `4 · Verify`
4. শেষে `#bot-admin`-এ `!doctor` দিয়ে স্বাস্থ্য পরীক্ষা করুন।
