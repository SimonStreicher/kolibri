const logging = require('logging').getLogger(__filename);
const rest = require('rest');
const mime = require('rest/interceptor/mime');
const csrf = require('rest/interceptor/csrf');
const errorCode = require('rest/interceptor/errorCode');
const ConditionalPromise = require('./conditionalPromise');

/**
 * A helping method to get specific cookie based on its name.
 * @param {string} name  - the name of the cookie.
 * @returns {string} - cookieValue
 * this function could probably find a better place to live..
 */
function getCookie(name) {
  let cookieValue = null;
  if (document.cookie && document.cookie !== '') {
    const cookies = document.cookie.split(';');
    for (let i = 0; i < cookies.length; i++) {
      const cookie = cookies[i].trim();
      // Does this cookie string begin with the name we want?
      if (cookie.substring(0, name.length + 1) === (name.concat('='))) {
        cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
        break;
      }
    }
  }
  return cookieValue;
}


/** Class representing a single API resource object */
class Model {
  /**
   * Create a model instance.
   * @param {object} data - data to insert into the model at creation time - should include at
   * least an id for fetching, or data an no id if the intention is to save a new model.
   * @param {Resource} resource - object of the Resource class, specifies the urls and fetching
   * behaviour for the model.
   */
  constructor(data, resource) {
    this.resource = resource;
    if (!this.resource) {
      throw new TypeError('resource must be defined');
    }

    // Assign any data to the attributes property of the Model.
    this.attributes = {};
    this.set(data);

    this.synced = false;

    // Keep track of any unresolved promises that have been generated by async methods of the Model
    this.promises = [];
  }

  /**
   * Method to fetch data from the server for this particular model.
   * @param {object} params - an object of parameters to be parsed into GET parameters on the
   * fetch.
   * @param {boolean} [force=false] - fetch whether or not it's been synced already.
   * @returns {Promise} - Promise is resolved with Model attributes when the XHR successfully
   * returns, otherwise reject is called with the response object.
   */
  fetch(params = {}, force = false) {
    const promise = new ConditionalPromise((resolve, reject) => {
      Promise.all(this.promises).then(() => {
        if (!force && this.synced) {
          resolve(this.attributes);
        } else {
          this.synced = false;
          // Do a fetch on the URL.
          this.resource.client({ path: this.url, params }).then((response) => {
            // Set the retrieved Object onto the Model instance.
            this.set(response.entity);
            // Flag that the Model has been fetched.
            this.synced = true;
            // Resolve the promise with the attributes of the Model.
            resolve(this.attributes);
            // Clean up the reference to this promise
            this.promises.splice(this.promises.indexOf(promise), 1);
          }, (response) => {
            logging.error('An error occurred', response);
            reject(response);
            // Clean up the reference to this promise
            this.promises.splice(this.promises.indexOf(promise), 1);
          });
        }
      },
      (reason) => {
        reject(reason);
      });
    });
    this.promises.push(promise);
    return promise;
  }

  /**
   * Method to save data to the server for this particular model.
   * @param {object} attrs - an object of attributes to be saved on the model.
   * @returns {Promise} - Promise is resolved with Model attributes when the XHR successfully
   * returns, otherwise reject is called with the response object.
   */
  save(attrs) {
    const promise = new ConditionalPromise((resolve, reject) => {
      Promise.all(this.promises).then(() => {
        let payload = {};
        if (this.synced) {
          // Model is synced with the server, so we can do dirty checking.
          Object.keys(attrs).forEach((key) => {
            if (attrs[key] !== this.attributes[key]) {
              payload[key] = attrs[key];
            }
          });
        } else {
          this.set(attrs);
          payload = this.attributes;
        }
        if (!Object.keys(payload).length) {
          // Nothing to save, so just resolve the promise now.
          resolve(this.attributes);
        } else {
          this.synced = false;
          let url;
          let clientObj;
          if (this.id) {
            // If this Model has an id, then can do a PATCH against the Model
            url = this.url;
            clientObj = { path: url, method: 'PATCH', entity: payload,
              headers: { 'Content-Type': 'application/json' } };
          } else {
            // Otherwise, must POST to the Collection endpoint to create the Model
            url = this.resource.collectionUrl();
            clientObj = { path: url, entity: payload,
              headers: { 'Content-Type': 'application/json' } };
          }
          // Do a save on the URL.
          this.resource.client(clientObj).then((response) => {
            const oldId = this.id;
            // Set the retrieved Object onto the Model instance.
            this.set(response.entity);
            // if the model did not used to have an id and now does, add it to the cache.
            if (!oldId && this.id) {
              this.resource.addModel(this);
            }
            // Flag that the Model has been fetched.
            this.synced = true;
            // Resolve the promise with the Model.
            resolve(response.entity);
            // Clean up the reference to this promise
            this.promises.splice(this.promises.indexOf(promise), 1);
          }, (response) => {
            logging.error('An error occurred', response);
            reject(response);
            // Clean up the reference to this promise
            this.promises.splice(this.promises.indexOf(promise), 1);
          });
        }
      },
      (reason) => {
        reject(reason);
      });
    });
    this.promises.push(promise);
    return promise;
  }

  /**
   * Method to delete model.
   * @param {Integer} id - target model's id.
   * @returns {Promise} - Promise is resolved with target model's id
   * returns, otherwise reject is called with the response object.
   */
  delete() {
    const promise = new ConditionalPromise((resolve, reject) => {
      Promise.all(this.promises).then(() => {
        if (!this.id) {
          // Nothing to delete, so just resolve the promise now.
          reject('Can not delete model that we do not have an id for');
        } else {
          // Otherwise, DELETE the Model
          const clientObj = { path: this.url, method: 'DELETE',
            headers: { 'Content-Type': 'application/json' } };
          this.resource.client(clientObj).then((response) => {
            // delete this instance
            this.resource.removeModel(this);
            // Resolve the promise with the id.
            // Vuex will use this id to delete the model in its state.
            resolve(this.id);
            // Clean up the reference to this promise
            this.promises.splice(this.promises.indexOf(promise), 1);
          }, (response) => {
            logging.error('An error occurred', response);
            reject(response);
            // Clean up the reference to this promise
            this.promises.splice(this.promises.indexOf(promise), 1);
          });
        }
      },
      (reason) => {
        reject(reason);
      });
    });
    this.promises.push(promise);
    return promise;
  }

  get url() {
    return this.resource.modelUrl(this.id);
  }

  get id() {
    return this.attributes[this.resource.idKey];
  }

  set(attributes) {
    // force IDs to always be strings - this should be changed on the server-side too
    if (attributes && this.resource.idKey in attributes) {
      attributes[this.resource.idKey] = String(attributes[this.resource.idKey]);
    }
    Object.assign(this.attributes, attributes);
  }
}

/** Class representing a 'view' of a single API resource.
 *  Contains different Model objects, depending on the parameters passed to its fetch method.
 */
class Collection {
  /**
   * Create a Collection instance.
   * @param {Object} params - Default parameters to use when fetching data from the server.
   * @param {Object[]|Model[]} data - Data to prepopulate the collection with,
   * useful if wanting to save multiple models.
   * @param {Resource} resource - object of the Resource class, specifies the urls and fetching
   * behaviour for the collection.
   */
  constructor(params = {}, data = [], resource) {
    this.resource = resource;
    this.params = params;
    if (!this.resource) {
      throw new TypeError('resource must be defined');
    }
    this.models = [];
    this._model_map = {};
    this.synced = false;
    this.set(data);
    // Keep track of any unresolved promises that have been generated by async methods of the Model
    this.promises = [];
  }

  /**
   * Method to fetch data from the server for this collection.
   * @param {object} extraParams - an object of parameters to be parsed into GET parameters on the
   * fetch.
   * @param {boolean} force - fetch whether or not it's been synced already.
   * @returns {Promise} - Promise is resolved with Array of Model attributes when the XHR
   * successfully returns, otherwise reject is called with the response object.
   */
  fetch(extraParams = {}, force = false) {
    const params = Object.assign({}, this.params, extraParams);
    const promise = new ConditionalPromise((resolve, reject) => {
      Promise.all(this.promises).then(() => {
        if (!force && this.synced) {
          resolve(this.data);
        } else {
          this.synced = false;
          this.resource.client({ path: this.url, params }).then((response) => {
            // Reset current models to only include ones from this fetch.
            this.models = [];
            this._model_map = {};
            // Set response object - an Array - on the Collection to record the data.
            // First check that the response *is* an Array
            if (Array.isArray(response.entity)) {
              this.set(response.entity);
            } else {
              // If it's not, there are two possibilities - something is awry, or we have received
              // paginated data! Check to see if it is paginated.
              if (typeof response.entity.results !== 'undefined') {
                // Paginated objects have 'results' as their results object so interpret this as
                // such.
                this.set(response.entity.results);
                this.pageCount = Math.ceil(response.entity.count / this.pageSize);
              } else {
                // It's all gone a bit Pete Tong.
                logging.debug('Data appears to be malformed', response.entity);
              }
            }
            // Mark that the fetch has completed.
            this.synced = true;
            this.models.forEach((model) => {
              model.synced = true; // eslint-disable-line no-param-reassign
            });
            // Return the data from the models, not the models themselves.
            resolve(this.data);
            // Clean up the reference to this promise
            this.promises.splice(this.promises.indexOf(promise), 1);
          }, (response) => {
            logging.error('An error occurred', response);
            reject(response);
            // Clean up the reference to this promise
            this.promises.splice(this.promises.indexOf(promise), 1);
          });
        }
      },
      (reason) => {
        reject(reason);
      });
    });
    this.promises.push(promise);
    return promise;
  }

  get url() {
    return this.resource.collectionUrl();
  }

  /**
   * Make a model a member of the collection - record in the models Array, and in the mapping
   * from id to model. Will automatically instantiate Models for data passed in as objects, and
   * deduplicate within the collection.
   * @param {(Object|Model|Object[]|Model[])} models - Either an Array or single instance of an
   * object or Model.
   */
  set(models) {
    let modelsToSet;
    if (!Array.isArray(models)) {
      modelsToSet = [models];
    } else {
      modelsToSet = models;
    }

    modelsToSet.forEach((model) => {
      // Note: this method ensures instantiation deduplication of models within the collection
      //  and across collections.
      const setModel = this.resource.addModel(model);
      if (!this._model_map[setModel.id]) {
        this._model_map[setModel.id] = setModel;
        this.models.push(setModel);
      }
    });
  }

  get data() {
    return this.models.map((model) => model.attributes);
  }

  get synced() {
    // We only say the Collection is synced if it, itself, is synced, and all its
    // constituent models are also.
    return this.models.reduce((synced, model) => synced && model.synced, this._synced);
  }

  set synced(value) {
    this._synced = value;
  }
}

/** Class representing a single API resource.
 *  Contains references to all Models that have been fetched from the server.
 *  Can also be subclassed in order to create custom behaviour for particular API resources.
 */
class Resource {
  /**
   * Create a resource with a Django REST API name corresponding to the name parameter.
   * @param {Kolibri} kolibri - The current instantiated instance of the core app.
   */
  constructor(kolibri) {
    this.clearCache();
    this.kolibri = kolibri;
  }

  /**
   * Optionally pass in data and instantiate a collection for saving that data or fetching
   * data from the resource.
   * @param {Object} params - default parameters to use for Collection fetching.
   * @param {Object[]} data - Data to instantiate the Collection - see Model constructor for
   * details of data.
   * @returns {Collection} - Returns an instantiated Collection object.
   */
  getCollection(params = {}, data = []) {
    let collection;
    // Sort keys in order, then assign those keys to an empty object in that order.
    // Then stringify to create a cache key.
    const key = JSON.stringify(
      Object.assign(
        {}, ...Object.keys(params).sort().map(
          (paramKey) => ({ [paramKey]: params[paramKey] })
        )
      )
    );
    if (!this.collections[key]) {
      collection = new Collection(params, data, this);
      this.collections[key] = collection;
    } else {
      collection = this.collections[key];
    }
    return collection;
  }

  /**
   * Get a Collection with pagination settings.
   * @param {Object} [params={}] - default parameters to use for Collection fetching.
   * @param {Number} [pageSize=20] - The number of items to return in a page.
   * @param {Number} [page=1] - Which page to return.
   * @returns {Collection} - Returns an instantiated Collection object.
   */
  getPagedCollection(params = {}, pageSize = 20, page = 1) {
    Object.assign(params, {
      page,
      page_size: pageSize,
    });
    const collection = this.getCollection(params);
    collection.page = page;
    collection.pageSize = pageSize;
    return collection;
  }

  /**
   * Get a model by id
   * @param {String} id - The primary key of the Model instance.
   * @returns {Model} - Returns a Model instance.
   */
  getModel(id) {
    let model;
    if (!this.models[id]) {
      model = this.createModel({ [this.idKey]: id });
    } else {
      model = this.models[id];
    }
    return model;
  }

  /**
   * Add a model to the resource for deduplication, dirty checking, and tracking purposes.
   * @param {Object} data - The data for the model to add.
   * @returns {Model} - Returns the instantiated Model.
   */
  createModel(data) {
    const model = new Model(data, this);
    return this.addModel(model);
  }

  /**
   * Add a model to the resource for deduplication, dirty checking, and tracking purposes.
   * @param {Object|Model} model - Either the data for the model to add, or the Model itself.
   * @returns {Model} - Returns the instantiated Model.
   */
  addModel(model) {
    if (!(model instanceof Model)) {
      return this.createModel(model);
    }
    // Don't add to the model cache if the id is not defined.
    if (model.id) {
      if (!this.models[model.id]) {
        this.models[model.id] = model;
      } else {
        this.models[model.id].set(model.attributes);
      }
      return this.models[model.id];
    }
    return model;
  }

  /**
   * Reset the cache for this Resource.
   */
  clearCache() {
    this.models = {};
    this.collections = {};
  }

  unCacheModel(id) {
    this.models[id].synced = false;
  }

  removeModel(model) {
    delete this.models[model.id];
  }

  get urls() {
    return this.kolibri.urls;
  }

  get modelUrl() {
    // Leveraging Django REST Framework generated URL patterns.
    return this.urls[`${this.name}_detail`];
  }

  get collectionUrl() {
    // Leveraging Django REST Framework generated URL patterns.
    return this.urls[`${this.name}_list`];
  }

  static idKey() {
    return 'id';
  }

  get idKey() {
    // In IE <= 10, static methods are not properly inherited
    // Do this to still return a value.
    // N.B. This will prevent a resource being subclassed from another
    // resource, but then being able to reference its parent's
    // idKey.
    return this.constructor.idKey ? this.constructor.idKey() : 'id';
  }

  static resourceName() {
    throw new ReferenceError('name is not defined for the base Resource class - please subclass.');
  }

  get name() {
    return this.constructor.resourceName();
  }

  get client() {
    return rest.wrap(mime).wrap(csrf, { name: 'X-CSRFToken',
      token: getCookie('csrftoken') }).wrap(errorCode);
  }
}

/** Class to manage all API resources.
 *  This is instantiated and attached to the core app constructor, and its methods exposed there.
 *  This means that a particular Resource should only be instantiated once during the lifecycle
 * of the app, allowing for easy caching, as all Model instances can be shared in the central
 * resource.
 */
class ResourceManager {
  /**
   * Instantiate a Resource Manager to manage the creation of Resources.
   * @param {Kolibri} kolibri - The current instantiated instance of the core app - needed to
  * reference the urls.
   */
  constructor(kolibri) {
    this._kolibri = kolibri;
    this._resources = {};
  }

  /**
   * Register a resource with the resource manager. Only one resource of a particular name can be
   * registered.
   * @param {Resource} ResourceClass - The subclass of Resource to use in registering the
   * resource. This is used to register a resource with specific subclassed behaviour for that
   * resource.
   * @returns {Resource} - Return the instantiated Resource.
   */
  registerResource(className, ResourceClass) {
    if (!className) {
      throw new TypeError('You must specify a className!');
    }
    if (!ResourceClass) {
      throw new TypeError('You must specify a ResourceClass!');
    }
    const name = ResourceClass.resourceName();
    if (!name) {
      throw new TypeError('A resource must have a defined resource name!');
    }
    if (this._resources[name]) {
      throw new TypeError('A resource with that name has already been registered!');
    }
    this._resources[name] = new ResourceClass(this._kolibri);
    Object.defineProperty(this, className, { value: this._resources[name] });
    return this._resources[name];
  }

  /**
   * Clear all caches for registered resources.
   */
  clearCaches() {
    Object.keys(this._resources).forEach((key) => {
      this._resources[key].clearCache();
    });
  }

}

module.exports = {
  ResourceManager,
  Resource,
};
