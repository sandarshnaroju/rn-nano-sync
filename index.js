import axios, {all} from 'axios';
import {RSA} from 'react-native-rsa-native';
import {APP_URL, CLIENT_ID, CLIENT_SECRET} from '../../nano.config.js';
import Base64 from 'react-native-nano/src/core/utils/Base64';
import {EventRegister} from 'react-native-event-listeners';
import getDatabase from 'react-native-nano/src/core/modules/database/RealmDatabase';
const BASE_URL = 'https://nanoapp.dev/';
const GET_TOKEN_URL = BASE_URL + 'auth/token/';

const FETCH_ALL_SCREENS = APP_URL;
const Realm = getDatabase();
export const DATABASE_CONSTANTS = {
  AUTH: 'auth',
  EXPIRY_TIME_STAMP: 'expiry_time',
  PUBLIC_KEY: 'PUBLIC_KEY',
  NAME_AND_SCREEN_URL_OBJECT: 'nano_name_and_screen_url_object',
};

export const getAuthTokenAndStoreInRealm = () => {
  if (
    CLIENT_ID == null ||
    CLIENT_SECRET == null ||
    CLIENT_SECRET == 'secret' ||
    CLIENT_ID == 'id'
  ) {
    return null;
  }
  const secret = Base64.btoa(CLIENT_ID + ':' + CLIENT_SECRET);

  const body = {
    grant_type: 'client_credentials',
  };
  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
    Authorization: 'Basic ' + secret,
  };

  return axios({
    method: 'POST'.toLowerCase(),
    url: GET_TOKEN_URL,
    data: body,
    headers: headers,
  })
    .then(json => {
      if (json != null && json.data != null && json.data.access_token != null) {
        const curr = Date.now();
        const expiryTime = json.data.expires_in * 1000 + curr;

        Realm.setValue(DATABASE_CONSTANTS.EXPIRY_TIME_STAMP, expiryTime + '');
        Realm.setValue(DATABASE_CONSTANTS.AUTH, json.data.access_token);
        Realm.setValue(DATABASE_CONSTANTS.PUBLIC_KEY, json.data.key);

        return json.data.access_token;
      }
    })
    .catch(err => {
      console.log('auth token refresh error', err);
    });
};

const checkValidityAndGetAuth = async () => {
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

    authToken['value'] = await getAuthTokenAndStoreInRealm();
  }
  return authToken['value'];
};
const isDataVerified = async ({message, signature}) => {
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

export const fetchScreenAndStoreInDb = async ({screenUrl, code_hash = ''}) => {
  try {
    const auth = await checkValidityAndGetAuth();
    if (auth == null) {
      return null;
    }

    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      Authorization: 'Bearer ' + auth,
      code_hash,
    };

    return axios({
      method: 'POST'.toLowerCase(),
      url: screenUrl,
      headers: headers,
    })
      .then(async json => {
        if (json != null && json.status == 200) {
          const isVerified = await isDataVerified({
            message: json.data.data.json,
            signature: json.data.data.signature,
          });

          if (isVerified) {
            const decoded = Base64.atob(json.data.data.json);
            const parsedCode = JSON.parse(decoded);

            Realm.setValue(screenUrl, JSON.stringify(json.data.data));

            EventRegister.emit('nano-single-screen-load', screenUrl);
            return parsedCode;
          } else {
            return null;
          }
        } else {
          return null;
        }
      })
      .catch(err => {
        return null;
      });
  } catch (error) {}
};
export const fetchScreenFromDb = async ({screenUrl}) => {
  return await fetchScreenAndStoreInDb({screenUrl});
};

export const fetchAllScreens = async () => {
  const auth = await checkValidityAndGetAuth();
  if (auth == null) {
    return null;
  }
  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
    Authorization: 'Bearer ' + auth,
  };

  return axios({
    method: 'POST'.toLowerCase(),
    url: FETCH_ALL_SCREENS,
    headers: headers,
  })
    .then(async json => {
      if (json != null && json.status == 200) {
        const isVerified = await isDataVerified({
          message: json.data.data.config,
          signature: json.data.data.signature,
        });

        if (isVerified) {
          const decoded = Base64.atob(json.data.data.config);
          const parsed = JSON.parse(decoded);
          Realm.setValue(
            DATABASE_CONSTANTS.NAME_AND_SCREEN_URL_OBJECT,
            decoded,
          );
          return parsed;
        } else {
          return null;
        }
      } else {
        return null;
      }
    })
    .catch(err => {
      console.log('fetching all screens error', err);

      return null;
    });
};

const getCompleteScreensAndStoreInDb = () => {
  fetchAllScreens()
    .then(allsc => {
      if (allsc) {
        EventRegister.emit('nano-all-screens-load', true);
      }
    })
    .catch(() => {});
};

export const init = navRef => {
  getCompleteScreensAndStoreInDb();

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
            });
          }
        }
      }
    });
  }
};
