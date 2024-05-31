import axios from 'axios';
import {RSA} from 'react-native-rsa-native';
import {APP_URL, CLIENT_ID, CLIENT_SECRET} from '../../nano.config.js';
import Base64 from 'react-native-nano/src/core/utils/Base64';
import {EventRegister} from 'react-native-event-listeners';
import getDatabase from 'react-native-nano/src/core/modules/database/RealmDatabase';
const FormData = require('form-data');
export const DATABASE_CONSTANTS = {
  AUTH: 'auth',
  EXPIRY_TIME_STAMP: 'expiry_time',
  PUBLIC_KEY: 'PUBLIC_KEY',
  NAME_AND_SCREEN_URL_OBJECT: 'nano_name_and_screen_url_object',
};
let appUrl = null;
let appSecret = null;
let appId = null;
const BASE_URL = 'https://www.nanoapp.dev/';

if (!appSecret) {
  appSecret = CLIENT_SECRET;
}
if (!appId) {
  appId = CLIENT_ID;
}
if (!appUrl) {
  appUrl = APP_URL;
}

const GET_TOKEN_URL = BASE_URL + 'auth/token/';

const FETCH_ALL_SCREENS = appUrl;
export const getAuthTokenAndStoreInRealm = async (
  database: object,
): Promise<string> => {
  const Realm = getDatabase(database, null);

  if (
    appId == null ||
    appSecret == null ||
    appSecret === 'secret' ||
    appId === 'id'
  ) {
    return null;
  }

  const secret = Base64.btoa(appId + ':' + appSecret);

  let data = new FormData();
  data.append('grant_type', 'client_credentials');
  const headers = {
    'Content-Type': 'multipart/form-data',
    Accept: 'application/json',
    Authorization: 'Basic ' + secret,
  };

  try {
    const response = await axios.post(GET_TOKEN_URL, data, {headers});

    if (response && response.data && response.data.access_token) {
      const curr = Date.now();
      const expiryTime = response.data.expires_in * 1000 + curr;

      Realm.setValue(DATABASE_CONSTANTS.EXPIRY_TIME_STAMP, expiryTime + '');
      Realm.setValue(DATABASE_CONSTANTS.AUTH, response.data.access_token);

      Realm.setValue(DATABASE_CONSTANTS.PUBLIC_KEY, response.data.key);

      return response.data.access_token;
    }
  } catch (error) {
    console.log('auth token', error);
    throw error;
  }
};

const checkValidityAndGetAuth = async (database: object): Promise<string> => {
  const Realm = getDatabase(database, null);

  let authToken = Realm.getValue(DATABASE_CONSTANTS.AUTH);
  let expiryTime = Realm.getValue(DATABASE_CONSTANTS.EXPIRY_TIME_STAMP);

  const curr = Date.now();
  if (
    authToken == null ||
    expiryTime == null ||
    authToken['value'] == null ||
    expiryTime['value'] < curr
  ) {
    authToken = {};

    authToken['value'] = await getAuthTokenAndStoreInRealm(database);
  }
  return authToken['value'];
};

const isDataVerified = async ({
  message,
  signature,
  database,
}: {
  message: string;
  signature: string;
  database: object;
}): Promise<boolean> => {
  const Realm = getDatabase(database, null);

  const publicKeyObj = Realm.getValue(DATABASE_CONSTANTS.PUBLIC_KEY);

  const publicKey = Base64.atob(publicKeyObj['value']);
  let isVerified = false;

  isVerified = await RSA.verifyWithAlgorithm(
    signature,

    message,

    publicKey,
    RSA.SHA256withRSA,
  ).catch(e => {
    isVerified = false;
  });

  return isVerified;
};

export const fetchScreenAndStoreInDb = async ({
  screenUrl,
  code_hash = '',
  database,
}: {
  screenUrl: string;
  code_hash: string;
  database: object;
}): Promise<Object | null> => {
  const Realm = getDatabase(database, null);

  try {
    const auth = await checkValidityAndGetAuth(database);
    if (auth == null) {
      return null;
    }

    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      Authorization: 'Bearer ' + auth,
      code_hash,
    };
    const updatedScreenUrl = screenUrl.replace(/^http:/, 'https:');
    const response = await axios.request({
      method: 'POST',
      headers,
      url: updatedScreenUrl,
    });

    if (response != null && response.status === 200) {
      const isVerified = await isDataVerified({
        message: response.data.data.json,
        signature: response.data.data.signature,
        database,
      });

      if (isVerified) {
        const decoded = Base64.atob(response.data.data.json);
        const parsedCode = JSON.parse(decoded);

        Realm.setValue(screenUrl, JSON.stringify(response.data.data));

        EventRegister.emit('nano-single-screen-load', screenUrl);
        return parsedCode;
      } else {
        return null;
      }
    } else {
      return null;
    }
  } catch (error) {}
};
export const fetchScreenFromDb = async ({
  screenUrl,
  database,
}: {
  screenUrl: string;
  database: object;
}): Promise<object> => {
  return await fetchScreenAndStoreInDb({
    screenUrl,
    code_hash: '',
    database,
  });
};

export const fetchAllScreens = async (
  database: object,
): Promise<Object | null> => {
  const Realm = getDatabase(database, null);

  try {
    const auth = await checkValidityAndGetAuth(database);

    if (auth == null) {
      return null;
    }

    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      Authorization: 'Bearer ' + auth,
    };
    const actualAppUrl =
      appUrl != null && appUrl.length > 0 ? appUrl : FETCH_ALL_SCREENS;
    const updatedAllScreenUrl =
      actualAppUrl != null && actualAppUrl.length > 0
        ? actualAppUrl.replace(/^http:/, 'https:')
        : '';

    const response = await axios.post(updatedAllScreenUrl, undefined, {
      headers,
    });

    if (response != null && response.status === 200) {

      const isVerified = await isDataVerified({
        message: response.data.data.config,
        signature: response.data.data.signature,
        database,
      });

      if (isVerified) {
        const decoded = Base64.atob(response.data.data.config);
        const parsed = JSON.parse(decoded);

        Realm.setValue(DATABASE_CONSTANTS.NAME_AND_SCREEN_URL_OBJECT, decoded);

        return parsed;
      } else {
        return null;
      }
    } else {
      return null;
    }
  } catch (error) {
    console.log('Fetching all screens error', error);
    return null;
  }
};

const getCompleteScreensAndStoreInDb = async (
  database: object,
): Promise<void> => {
  const allsc = await fetchAllScreens(database);

  if (allsc) {
    EventRegister.emit('nano-all-screens-load', true);
  }
};

export const setAppDetails = ({
  app_id,
  app_url,
  app_secret,
}: {
  app_id: string;
  app_url: string;
  app_secret: string;
}): void => {
  if (app_id) {
    appId = app_id;
  }
  if (app_secret) {
    appSecret = app_secret;
  }

  if (app_url) {
    appUrl = app_url;
  }
};

export const init = (navRef, database): void => {
  getCompleteScreensAndStoreInDb(database);
  const Realm = getDatabase(database, null);

  if (navRef != null) {
    navRef.addListener('state', navData => {
      if (
        navData != null &&
        navData['data'] != null &&
        navData['data']['state'] != null &&
        navData['data']['state']['routes'] != null &&
        navData['data']['state']['index'] != null
      ) {
        const currentRoute =
          navData['data']['state']['routes'][navData['data']['state']['index']];
        const screenNameUrlArray = Realm.getValue(
          DATABASE_CONSTANTS.NAME_AND_SCREEN_URL_OBJECT,
        );
        if (screenNameUrlArray != null && screenNameUrlArray['value'] != null) {
          const parsed = JSON.parse(screenNameUrlArray['value']);

          const currentScreenObject = parsed.find(
            s => s.name == currentRoute['name'],
          );

          if (currentScreenObject) {
            fetchScreenAndStoreInDb({
              screenUrl: currentScreenObject['url'],
              code_hash: currentScreenObject['code_hash'],
              database,
            });
          }
        }
      }
    });
  }
};
