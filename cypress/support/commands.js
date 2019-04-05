import { defaultTestUserEmail } from './data';
import { randomEmail } from './faker';
import { getLoggedInUserQuery } from '../../src/graphql/queries';

/**
 * Login with an exising account. If not provided in `params`, the email used for
 * authentication will be `defaultTestUserEmail`.
 *
 * @param {object} params:
 *    - redirect: The redirect URL
 *    - email: User email
 */
Cypress.Commands.add('login', (params = {}) => {
  const { email = defaultTestUserEmail, redirect = null, visitParams } = params;
  const user = { email, newsletterOptIn: false };

  return signinRequest(user, redirect).then(({ body: { redirect } }) => {
    // Test users are allowed to signin directly with E2E, thus a signin URL
    // is directly returned by the API. See signin function in
    // opencollective-api/server/controllers/users.js for more info
    return cy.visit(redirect, visitParams).then(() => user);
  });
});

/**
 * Create a new account an SignIn. If no email is provided in `params`, the account
 * will be generated using a random email.
 */
Cypress.Commands.add('signup', ({ user = {}, redirect = '/', visitParams } = {}) => {
  if (!user.email) {
    user.email = randomEmail();
  }

  return signinRequest(user, redirect).then(({ body: { redirect } }) => {
    // Test users are allowed to signin directly with E2E, thus a signin URL
    // is directly returned by the API. See signin function in
    // opencollective-api/server/controllers/users.js for more info
    const token = getTokenFromRedirectUrl(redirect);
    if (token) {
      return getLoggedInUserFromToken(token).then(user => {
        return cy.visit(redirect, visitParams).then(() => user);
      });
    } else {
      return cy.visit(redirect, visitParams).then(() => user);
    }
  });
});

/**
 * Open a link not covered by `baseUrl`.
 * See https://github.com/cypress-io/cypress/issues/1777
 */
Cypress.Commands.add('openExternalLink', url => {
  cy.visit('/signin').then(window => {
    const linkIdentifier = '__TMP_CY_EXTERNAL_LINK__';
    const link = window.document.createElement('a');
    link.innerHTML = linkIdentifier;
    link.setAttribute('href', url);
    link.setAttribute('id', linkIdentifier);
    window.document.body.appendChild(link);
    cy.get(`#${linkIdentifier}`).click();
  });
});

/**
 * Returns all the email sent by the API
 */
Cypress.Commands.add('getInbox', () => {
  return cy
    .request({
      url: `${Cypress.env('MAILDEV_URL')}/email`,
      method: 'GET',
    })
    .then(({ body }) => {
      return body;
    });
});

/**
 * Navigate to an email in maildev.
 *
 * API must be configured to use maildev (MAILDEV=true) and the service must be
 * started (`npm run maildev` on the API).
 *
 * @param emailMatcher {func} - used to find the email. Gets passed an email. To see the
 *  list of all fields, check https://github.com/djfarrelly/MailDev/blob/master/docs/rest.md
 */
Cypress.Commands.add('openEmail', emailMatcher => {
  return loopOpenEmail(emailMatcher);
});

/**
 * Clear maildev inbox.
 */
Cypress.Commands.add('clearInbox', () => {
  return cy.request({
    url: `${Cypress.env('MAILDEV_URL')}/email/all`,
    method: 'DELETE',
    headers: {
      Accept: 'application/json',
    },
  });
});

/**
 * Create a collective. Admin will be the user designated by `email`. If not
 * provided, the email used will default to `defaultTestUserEmail`.
 */
Cypress.Commands.add('createCollective', ({ type = 'ORGANIZATION', email = defaultTestUserEmail }) => {
  const user = { email, newsletterOptIn: false };
  return signinRequest(user, null).then(response => {
    const token = getTokenFromRedirectUrl(response.body.redirect);
    return graphqlQuery(token, {
      operationName: 'createCollective',
      query: `
          mutation createCollective($collective: CollectiveInputType!) {
            createCollective(collective: $collective) {
              id
              slug
            }
          }
        `,
      variables: { collective: { location: {}, name: 'TestOrg', slug: '', tiers: [], type } },
    }).then(({ body }) => {
      return body.data.createCollective;
    });
  });
});

/**
 * Add a stripe credit card on the collective designated by `collectiveSlug`.
 */
Cypress.Commands.add('addCreditCardToCollective', ({ collectiveSlug }) => {
  cy.login({ redirect: `/${collectiveSlug}/edit/payment-methods` });
  cy.contains('button', 'Add a payment method').click();
  cy.wait(2000);
  fillStripeInput();
  cy.wait(1000);
  cy.contains('button[type="submit"]', 'Save').click();
  cy.wait(2000);
});

/**
 * Fill a stripe creditcard input.
 *
 * @param container {DOM|null} pass it if you have multiple stripe inputs on the page
 * @param {object} cardParams the credit card info. Defaults to a valid card
 *    - creditCardNumber
 *    - expirationDate
 *    - cvcCode
 *    - postalCode
 */
Cypress.Commands.add('fillStripeInput', fillStripeInput);

/**
 * To use on the "Payment" step in the contribution flow.
 * Use the first payment method if available or fill the
 * stripe form otherwise.
 */
Cypress.Commands.add('useAnyPaymentMethod', () => {
  return cy.get('#PaymentMethod').then($paymentMethod => {
    // Checks if the organization already has a payment method configured
    if (!$paymentMethod.text().includes('VISA **** 4242')) {
      cy.wait(1000); // Wait for stripe to be loaded
      cy.fillStripeInput();
    }
  });
});

/**
 * A helper for the `StepsProgress` component to check that the steps in params
 * are enabled or disabled. `enabled` and `disabled` can both be passed an array
 * of strings or a single string.
 */
Cypress.Commands.add('checkStepsProgress', ({ enabled = [], disabled = [] }) => {
  const isEnabled = step => cy.get(`.step-${step}`).should('not.have.class', 'disabled');
  const isDisabled = step => cy.get(`.step-${step}`).should('have.class', 'disabled');

  Array.isArray(enabled) ? enabled.forEach(isEnabled) : isEnabled(enabled);
  Array.isArray(disabled) ? disabled.forEach(isDisabled) : isDisabled(disabled);
});

/**
 * Check if user is logged in by searching for its username in navbar
 */
Cypress.Commands.add('assertLoggedIn', (username, timeout) => {
  cy.log('Ensure user is logged in');
  const loginSection = cy.get('.LoginTopBarProfileButton-name', { timeout });
  if (username) {
    loginSection.should('contain', username);
  }
});

/**
 * A helper to fill input fields generated by the `InputField` component.
 */
Cypress.Commands.add('fillInputField', (fieldname, value) => {
  return cy.get(`.inputField.${fieldname} input`).type(value);
});

// ---- Private ----

function signinRequest(user, redirect) {
  return cy.request({
    url: '/api/users/signin',
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ user, redirect }),
  });
}

function getTokenFromRedirectUrl(url) {
  const regex = /\/signin\/([^?]+)/;
  return regex.exec(url)[1];
}

function graphqlQuery(token, body) {
  return cy.request({
    url: '/api/graphql',
    method: 'POST',
    headers: {
      Accept: 'application/json',
      authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

function getLoggedInUserFromToken(token) {
  return graphqlQuery(token, {
    operationName: 'LoggedInUser',
    query: getLoggedInUserQuery.loc.source.body,
  }).then(({ body }) => {
    return body.data.LoggedInUser;
  });
}

function fillStripeInput(
  container,
  cardParams = {
    creditCardNumber: '4242424242424242',
    expirationDate: '1250',
    cvcCode: '123',
    postalCode: '42222',
  },
) {
  const stripeIframeSelector = '.__PrivateStripeElement iframe';
  const iframePromise = container ? container.find(stripeIframeSelector) : cy.get(stripeIframeSelector);

  return iframePromise.then(iframe => {
    const { creditCardNumber, expirationDate, cvcCode, postalCode } = cardParams;
    const body = iframe.contents().find('body');
    const fillInput = (index, value) => {
      if (value === undefined) {
        return;
      }

      return cy
        .wrap(body)
        .find(`input:eq(${index})`)
        .type(`{selectall}${value}`);
    };

    fillInput(1, creditCardNumber);
    fillInput(2, expirationDate);
    fillInput(3, cvcCode);
    fillInput(4, postalCode);
  });
}

function loopOpenEmail(emailMatcher, timeout = 8000) {
  return cy.getInbox().then(body => {
    const email = body.find(emailMatcher);
    if (email) {
      return cy.openExternalLink(`${Cypress.env('MAILDEV_URL')}/email/${email.id}/html`);
    } else if (timeout > 0) {
      cy.wait(100);
      return loopOpenEmail(emailMatcher, timeout - 100);
    }
  });
}
