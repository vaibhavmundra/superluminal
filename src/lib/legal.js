// ---------------------------------------------------------------------------
// THE LEGAL PAGES, AS DATA.
//
// CONTENT AND LAYOUT ARE SEPARATED HERE FOR ONE REASON, AND IT IS NOT PURITY:
// these three documents get edited by somebody reading them as PROSE — a lawyer,
// or the founder after a lawyer — and asking that person to find a clause inside
// JSX, between a `className` full of Tailwind and a self-closing tag, is how a
// correction gets made in one of the three and not the other two. Here a section
// is a heading and some paragraphs, and that is all it looks like.
//
// THE ENTITY IS ONE OBJECT AND IS NEVER SPELLED OUT TWICE. Zima Blue Private
// Limited also trades as Designopolis (learn.designopolis.co.in), so the company
// details, the registered address and the jurisdiction are the SAME facts in two
// products — and a company that has moved office must not be left half-moved
// because its address was typed into nine paragraphs.
//
// NOT DRAFTED BY A LAWYER. This is ordinary boilerplate for an Indian SaaS
// company, adapted from the pages the same entity already publishes for its
// other product, and it is written to be reviewed rather than to be relied on.
// The clauses most worth a professional eye are flagged in the handover, not in
// the copy — a document that hedges about itself is worse than one that does not
// exist.
//
// THE ONE CLAUSE THAT IS NOT BOILERPLATE is the design disclaimer in the terms.
// This app outputs fixture positions, lumen figures and switchboard layouts, and
// somebody will hand one to an electrician. Saying plainly that it is a design
// aid rather than certified electrical engineering is the single most important
// sentence in these three files, and it is specific to what this product does.
// ---------------------------------------------------------------------------

/** The company behind the product, stated once. */
export const ENTITY = {
  company: 'Zima Blue Private Limited',
  product: 'Super Luminal',
  site: 'superluminal.design',
  email: 'hello@superluminal.design',
  address: '2nd floor, Geetanjali Complex, Sevoke Road, Siliguri 734001, West Bengal, India',
  gstin: '19AABCZ6133H1Z5',
  forum: 'Siliguri, West Bengal',
};

/**
 * THE REFUND WINDOW, AS A NUMBER, BECAUSE IT IS THE ONE COMMERCIAL DECISION IN
 * THESE THREE DOCUMENTS. Everything else here is a description of how the
 * product already works; this is a promise about money, it is the clause
 * customers quote back, and changing it should be a one-character edit rather
 * than a hunt through prose.
 */
export const REFUND_WINDOW_DAYS = 7;

const P = (...paras) => paras;

export const DOCS = {
  terms: {
    slug: 'terms',
    title: 'Terms of Service',
    intro: `These terms govern your use of ${ENTITY.product}, a lighting design tool `
      + `operated by ${ENTITY.company}. By creating an account or using the service you `
      + `agree to them. If you are using ${ENTITY.product} on behalf of a firm, you `
      + 'confirm you are authorised to accept these terms for that firm.',
    sections: [
      { h: 'The service', p: P(
        `${ENTITY.product} takes a floor plan you upload and helps you lay out lighting `
        + 'for it: fixture positions, illuminance estimates, a bill of quantities and '
        + 'related drawings. You may export what you produce and use it in your own '
        + 'professional work.',
        'We may add, change or withdraw features. Where a change materially reduces what '
        + 'a paid plan provides, we will tell account holders before it takes effect.',
      ) },

      // THE CLAUSE THIS PRODUCT ACTUALLY NEEDS. Everything above and below it is
      // standard; this one is about what happens when somebody builds from an
      // export, and it is why it sits this high in the document rather than
      // buried in the warranty section where boilerplate would put it.
      { h: 'What the output is, and what it is not', p: P(
        `${ENTITY.product} is a design aid. The layouts, lumen figures, load estimates and `
        + 'switchboard diagrams it produces are calculated from the plan you supply and '
        + 'from assumptions about ceiling heights, surface reflectance, fixture '
        + 'performance and room use. They are not a certified electrical design, a '
        + 'photometric survey, or a substitute for professional engineering judgement.',
        'Before anything is installed, built from or tendered against, the output must be '
        + 'reviewed by a suitably qualified professional and checked against the '
        + 'applicable electrical safety standards, building regulations and local codes. '
        + 'You are responsible for that review. We are not liable for work carried out '
        + 'from an unreviewed export.',
      ) },

      { h: 'Your account', p: P(
        'You sign in with your mobile number and a one-time code sent by SMS. Keep '
        + 'access to that number secure: anyone who can receive your codes can reach '
        + 'your account and everything in it.',
        'You must be old enough to enter a contract in your jurisdiction. One account is '
        + 'for one person. Tell us promptly if you believe your account has been used '
        + 'without your permission.',
      ) },

      { h: 'Your drawings and your work', p: P(
        'You keep ownership of everything you upload and everything you produce. We claim '
        + 'no rights in your drawings, your designs or your exports.',
        'You grant us only the permission we need to run the service for you: to store '
        + 'your files, process them so the product can function, and display them back to '
        + 'you and to anyone you share a project with. That permission ends when you '
        + 'delete the material or close your account.',
        'You confirm you have the right to upload what you upload, and that doing so does '
        + 'not breach anyone else’s copyright, contract or confidence.',
      ) },

      { h: 'Sharing', p: P(
        'You can share a project by email address or by link. A share is a grant of '
        + 'access that you control and can revoke. Anyone holding a live view link can '
        + 'open the project, so treat a link as you would the drawing itself.',
      ) },

      { h: 'Plans, billing and taxes', p: P(
        'Paid plans are billed in advance through our payment provider, either as a '
        + 'subscription that renews automatically or as a single period, depending on the '
        + 'plan you choose. Prices are shown before you pay.',
        `${ENTITY.company} is registered in India under GSTIN ${ENTITY.gstin}. Applicable `
        + 'taxes are charged as required by law.',
        'You can cancel a subscription at any time. Cancellation stops future charges; '
        + 'the period you have already paid for runs to its end. Refunds are governed by '
        + 'our Refund Policy.',
      ) },

      { h: 'Acceptable use', p: P(
        'Do not use the service to break the law, to infringe anyone’s rights, or to '
        + 'upload material you have no right to. Do not attempt to gain access to '
        + 'accounts, data or systems that are not yours, interfere with the service’s '
        + 'operation, or attempt to extract the service’s underlying models or datasets '
        + 'in bulk.',
        'We may suspend or close an account that does these things.',
      ) },

      { h: 'Availability', p: P(
        'We work to keep the service running, but we do not promise it will be '
        + 'uninterrupted or error-free. Maintenance, third-party outages and faults '
        + 'happen. Keep your own copies of work that matters to you.',
      ) },

      { h: 'Disclaimer and limitation of liability', p: P(
        'The service is provided "as is" and "as available". To the fullest extent the '
        + 'law allows, we exclude implied warranties of merchantability, fitness for a '
        + 'particular purpose and non-infringement.',
        'To the fullest extent the law allows, we are not liable for indirect or '
        + 'consequential loss, loss of profit, loss of contracts, or loss or corruption of '
        + 'data. Our total liability arising out of or in connection with the service is '
        + 'limited to the amount you paid us in the twelve months before the claim arose.',
        'Nothing in these terms excludes liability that cannot lawfully be excluded.',
      ) },

      { h: 'Indemnity', p: P(
        'You agree to indemnify us against claims, losses and reasonable costs arising '
        + 'from your breach of these terms, from material you upload, or from work '
        + 'carried out from an export that was not professionally reviewed.',
      ) },

      { h: 'Termination', p: P(
        'You may stop using the service and close your account at any time. We may '
        + 'suspend or end access where these terms are breached, or where we are required '
        + 'to by law. Clauses that by their nature should survive termination do so.',
      ) },

      { h: 'Changes to these terms', p: P(
        'We may update these terms. Continued use after a change means you accept the '
        + 'updated terms; if you do not, stop using the service and cancel any '
        + 'subscription.',
      ) },

      { h: 'Governing law', p: P(
        `These terms are governed by the laws of India, and the courts at `
        + `${ENTITY.forum} have exclusive jurisdiction over any dispute arising from them.`,
        'If any provision is held unenforceable, the rest remains in force.',
      ) },

      { h: 'Contact', p: P(
        `${ENTITY.company}, ${ENTITY.address}.`,
        `Questions about these terms: ${ENTITY.email}.`,
      ) },
    ],
  },

  privacy: {
    slug: 'privacy',
    title: 'Privacy Policy',
    intro: `This policy explains what ${ENTITY.company} collects when you use `
      + `${ENTITY.product}, why we collect it, and who else processes it on our behalf.`,
    sections: [
      { h: 'What we collect', p: P(
        'Your mobile number, which is how you sign in. We need it to send the one-time '
        + 'code that authenticates you.',
        'Your email address and your occupation, which we ask for once, before your first '
        + 'export. The address is used to send receipts and to reach you about a project '
        + 'shared with you; the occupation helps us decide what to build next.',
        'The plans you upload and the designs you create from them, together with the '
        + 'project and file names you give them.',
        'Ordinary technical data that any web service receives — IP address, browser and '
        + 'device information, and records of errors and of which features were used.',
        'Payment records. Card details are handled by our payment provider and are never '
        + 'sent to or stored by us.',
      ) },

      { h: 'Why we use it', p: P(
        'To run the service and keep you signed in; to process your drawings into '
        + 'lighting designs; to take payment and send receipts; to provide support; to '
        + 'diagnose faults and keep the service secure; and to understand which parts of '
        + 'the product are worth improving.',
        'We do not sell your personal data, and we do not use your drawings to advertise '
        + 'to you.',
      ) },

      // THE DISCLOSURE THAT MATTERS MOST AND IS EASIEST TO LEAVE OUT. Uploaded
      // plans are sent to third-party recognition services; a policy that listed
      // only the payment processor would be describing a different product.
      { h: 'Who processes it for us', p: P(
        'We use a small number of providers to run the service. Each receives only what '
        + 'it needs for its task, and each is bound to handle it on our instructions.',
        'Supabase — hosting, database, file storage and authentication, including the '
        + 'plans you upload.',
        'Twilio — sending the one-time codes to your mobile number.',
        'Razorpay — taking payments. They handle card details directly; we receive only '
        + 'the transaction record.',
        'Resend — sending transactional email such as receipts and share invitations.',
        'OpenAI and Roboflow — automated recognition of rooms, walls, doors and furniture '
        + 'in the plans you upload. Plan images are sent to these services for that '
        + 'analysis.',
        'Some of these providers operate outside India, so your information may be '
        + 'processed abroad under appropriate safeguards.',
      ) },

      { h: 'Sharing a project', p: P(
        'When you share a project, the people you share it with can see that project, the '
        + 'drawings in it and the email address or name you are identified by. That is the '
        + 'purpose of sharing, and it is under your control — you can change or revoke a '
        + 'share at any time.',
      ) },

      { h: 'How long we keep it', p: P(
        'We keep your account and its contents for as long as your account is open. If '
        + 'you close it, we delete or anonymise your personal data within a reasonable '
        + 'period, except where we must keep records — invoices and tax records in '
        + 'particular — for longer under Indian law.',
      ) },

      { h: 'Security', p: P(
        'Data is transmitted over encrypted connections and access is restricted to what '
        + 'each part of the system needs. No service can promise perfect security, but we '
        + 'take reasonable technical and organisational measures, and we will tell you if '
        + 'a breach affects your personal data in a way that requires it.',
      ) },

      { h: 'Cookies and local storage', p: P(
        'We use browser storage to keep you signed in and to remember small preferences, '
        + 'such as which panel you last had open. We do not use advertising cookies or '
        + 'third-party tracking pixels.',
      ) },

      { h: 'Your rights', p: P(
        'You can ask us for a copy of the personal data we hold about you, ask us to '
        + 'correct it, or ask us to delete it. You can withdraw consent where we rely on '
        + 'it, and you can complain to the relevant data protection authority.',
        `Write to ${ENTITY.email} and we will respond within the period the law requires.`,
      ) },

      { h: 'Children', p: P(
        'The service is intended for professional use and is not directed at children. We '
        + 'do not knowingly collect personal data from anyone below the age of majority in '
        + 'their jurisdiction.',
      ) },

      { h: 'Changes to this policy', p: P(
        'We may update this policy, and material changes will be brought to your '
        + 'attention in the app.',
      ) },

      { h: 'Contact', p: P(
        `${ENTITY.company}, ${ENTITY.address}.`,
        `Privacy questions, requests and grievances: ${ENTITY.email}.`,
      ) },
    ],
  },

  refund: {
    slug: 'refund',
    title: 'Refund Policy',
    intro: `This policy covers payments made to ${ENTITY.company} for ${ENTITY.product}. `
      + 'It sits alongside our Terms of Service.',
    sections: [
      { h: 'Try before you pay', p: P(
        `${ENTITY.product} can be used without payment so that you can judge whether it `
        + 'suits your work before you subscribe. We encourage you to do that, because it '
        + 'answers most of the questions a refund would otherwise settle.',
      ) },

      { h: 'When we refund', p: P(
        `If you are not satisfied with a new subscription, write to us within `
        + `${REFUND_WINDOW_DAYS} days of the first charge and we will refund it in full.`,
        'If you were charged in error — billed twice for one period, or charged after a '
        + 'cancellation took effect — we will refund that charge whenever you tell us, '
        + 'not only within the window above.',
        'If we withdraw the service, or a paid feature stops working and we cannot put it '
        + 'right, we will refund the unused part of the period you paid for.',
      ) },

      { h: 'When we do not', p: P(
        'Renewal charges on a subscription you have continued to use are not refundable. '
        + 'Cancel before the renewal date to avoid the next charge.',
        'We do not refund for a change of mind late in a paid period, or where an account '
        + 'was closed for a breach of the Terms of Service.',
      ) },

      { h: 'Cancelling', p: P(
        'You can cancel at any time. Cancellation stops future charges and the period you '
        + 'have already paid for runs to its end — we do not cut access short on '
        + 'cancellation, and there is no cancellation fee.',
      ) },

      { h: 'How to ask', p: P(
        `Email ${ENTITY.email} from the address on your account, or tell us the mobile `
        + 'number you sign in with, and say what you were charged and when. We will '
        + 'confirm within a few working days.',
      ) },

      { h: 'How a refund reaches you', p: P(
        'Approved refunds are returned through the original payment method by our payment '
        + 'provider. We process them within four weeks of agreeing the refund, and your '
        + 'bank or card issuer may take up to a further week to show it.',
      ) },

      { h: 'Contact', p: P(
        `${ENTITY.company}, ${ENTITY.address}.`,
        `Refund requests and questions: ${ENTITY.email}.`,
      ) },
    ],
  },
};

/** The three, in the order the footer lists them. */
export const LEGAL_LINKS = [
  { to: '/terms', label: 'Terms' },
  { to: '/privacy', label: 'Privacy' },
  { to: '/refund', label: 'Refunds' },
];
